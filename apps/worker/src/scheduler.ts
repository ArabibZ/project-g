import { delayFromSample } from "@project-g/shared";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { adminDb } from "./lib/db";
import { scrapeSource as fetchSourceJobs } from "./scraper";
import { nextNotificationRetryAt, processDueNotifications } from "./telegram";

export const SCHEDULER_NAME = "scheduler-v1";

const DB_TIMEOUT_MS = 10_000;
const LOCK_MS = 120_000;
const FAILURE_RETRY_MS = 30_000;

const sourceSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  position: z.number().int().nonnegative()
});

const stateSchema = z.object({
  status: z.enum(["waiting", "checking", "pausing", "paused", "no_active_sources", "error"]),
  pause_requested: z.boolean(),
  pause_reason: z.string().nullable(),
  current_source_id: z.string().uuid().nullable(),
  current_source_position: z.number().int().nullable(),
  queued_source_count: z.number().int().nonnegative(),
  last_check_at: z.string().nullable(),
  next_run_at: z.string().nullable(),
  active_run_id: z.string().uuid().nullable(),
  updated_at: z.string()
});

const completedSourceSchema = z.object({ status: z.enum(["succeeded", "failed"]) });
const notificationStateSchema = z.object({
  connected: z.boolean(),
  notifications_enabled: z.boolean()
});

type SourceSnapshot = z.infer<typeof sourceSchema>;
type PublicStateName = z.infer<typeof stateSchema>["status"];

type BatchState = {
  runKey: string;
  runId: string | null;
  sources: SourceSnapshot[];
  index: number;
  startedAt: string;
};

type RunLock = {
  token: string;
  expiresAt: number;
};

type StateUpdate = {
  status?: PublicStateName;
  pause_requested?: boolean;
  pause_reason?: string | null;
  current_source_id?: string | null;
  current_source_position?: number | null;
  queued_source_count?: number;
  last_check_at?: string | null;
  next_run_at?: string | null;
  active_run_id?: string | null;
};

export type SchedulerStatus = {
  status: PublicStateName;
  pauseRequested: boolean;
  pauseReason: string | null;
  running: boolean;
  currentSourceId: string | null;
  currentSourcePosition: number | null;
  queuedSourceCount: number;
  lastCheckAt: string | null;
  nextRunAt: string | null;
  activeRunId: string | null;
  updatedAt: string;
};

export type SchedulerAction = {
  accepted: boolean;
  state: SchedulerStatus;
};

function dbSignal(): AbortSignal {
  return AbortSignal.timeout(DB_TIMEOUT_MS);
}

function randomDelayMs(): number {
  const sample = crypto.getRandomValues(new Uint16Array(1))[0] ?? 0;
  return delayFromSample(sample) * 1000;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown scheduler error").slice(0, 1000);
}

export function getSchedulerStub(env: Env): DurableObjectStub<SchedulerCoordinator> {
  return env.COORDINATOR.getByName(SCHEDULER_NAME) as DurableObjectStub<SchedulerCoordinator>;
}

export class SchedulerCoordinator extends DurableObject<Env> {
  async status(): Promise<SchedulerStatus> {
    const [stored, lock] = await Promise.all([
      this.readPublicState(),
      this.ctx.storage.get<RunLock>("runLock")
    ]);
    return {
      status: stored.status,
      pauseRequested: stored.pause_requested,
      pauseReason: stored.pause_reason,
      running: Boolean(lock && lock.expiresAt > Date.now()),
      currentSourceId: stored.current_source_id,
      currentSourcePosition: stored.current_source_position,
      queuedSourceCount: stored.queued_source_count,
      lastCheckAt: stored.last_check_at,
      nextRunAt: stored.next_run_at,
      activeRunId: stored.active_run_id,
      updatedAt: stored.updated_at
    };
  }

  async start(): Promise<SchedulerAction> {
    return this.resume();
  }

  async resume(): Promise<SchedulerAction> {
    const { count, error } = await adminDb(this.env)
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("enabled", true)
      .abortSignal(dbSignal());
    if (error) throw new Error("Unable to count enabled sources");
    if ((count ?? 0) === 0) {
      await this.stopForNoActiveSources();
      return { accepted: false, state: await this.status() };
    }

    const lock = await this.ctx.storage.get<RunLock>("runLock");
    await this.ctx.storage.put("pauseRequested", false);
    await Promise.all([
      this.ctx.storage.delete("runAfterCurrent"),
      this.ctx.storage.delete("noActiveStop")
    ]);
    if (lock && lock.expiresAt > Date.now()) {
      await this.updatePublicState({ pause_requested: false, pause_reason: null });
    } else {
      const batch = await this.ctx.storage.get<BatchState>("batch");
      if (batch) await this.abandonBatch(batch);
      const nextRun = Date.now() + randomDelayMs();
      await this.ctx.storage.put("nextBatchAt", nextRun);
      await this.updatePublicState({
        status: "waiting",
        pause_requested: false,
        pause_reason: null,
        current_source_id: null,
        current_source_position: null,
        queued_source_count: 0,
        next_run_at: new Date(nextRun).toISOString(),
        active_run_id: null
      });
      if (batch) await this.ctx.storage.delete("batch");
    }
    await this.scheduleNextAlarm();
    return { accepted: true, state: await this.status() };
  }

  async requestPause(reason = "Paused by admin"): Promise<SchedulerAction> {
    const cleanReason = reason.trim().slice(0, 500) || "Paused by admin";
    const lock = await this.ctx.storage.get<RunLock>("runLock");
    await Promise.all([
      this.ctx.storage.put("pauseRequested", true),
      this.ctx.storage.delete("nextBatchAt"),
      this.ctx.storage.delete("runAfterCurrent"),
      this.ctx.storage.delete("noActiveStop")
    ]);
    if (lock && lock.expiresAt > Date.now()) {
      await this.updatePublicState({
        status: "pausing",
        pause_requested: true,
        pause_reason: cleanReason,
        next_run_at: null
      });
    } else {
      const batch = await this.ctx.storage.get<BatchState>("batch");
      if (batch) await this.abandonBatch(batch);
      await this.ctx.storage.delete("runLock");
      await this.updatePublicState({
        status: "paused",
        pause_requested: true,
        pause_reason: cleanReason,
        current_source_id: null,
        current_source_position: null,
        queued_source_count: 0,
        next_run_at: null,
        active_run_id: null
      });
      if (batch) await this.ctx.storage.delete("batch");
    }
    await this.scheduleNextAlarm();
    return { accepted: true, state: await this.status() };
  }

  async stopForNoActiveSources(): Promise<SchedulerAction> {
    const lock = await this.ctx.storage.get<RunLock>("runLock");
    await Promise.all([
      this.ctx.storage.put("pauseRequested", true),
      this.ctx.storage.put("noActiveStop", true),
      this.ctx.storage.delete("nextBatchAt"),
      this.ctx.storage.delete("runAfterCurrent")
    ]);
    if (lock && lock.expiresAt > Date.now()) {
      await this.updatePublicState({
        status: "pausing",
        pause_requested: true,
        pause_reason: "No active sources",
        next_run_at: null
      });
    } else {
      const batch = await this.ctx.storage.get<BatchState>("batch");
      if (batch) await this.abandonBatch(batch);
      await Promise.all([
        this.ctx.storage.delete("batch"),
        this.ctx.storage.delete("runLock")
      ]);
      await this.updatePublicState({
        status: "no_active_sources",
        pause_requested: true,
        pause_reason: "No active sources",
        current_source_id: null,
        current_source_position: null,
        queued_source_count: 0,
        next_run_at: null,
        active_run_id: null
      });
    }
    await this.scheduleNextAlarm();
    return { accepted: true, state: await this.status() };
  }

  async sourceEnabled(sourceId: string): Promise<void> {
    if (await this.pauseRequested()) return;
    const initial = await this.ctx.storage.get<BatchState>("batch");
    if (!initial) return;

    const { data, error } = await adminDb(this.env)
      .from("sources")
      .select("id, url, position")
      .eq("id", sourceId)
      .eq("enabled", true)
      .abortSignal(dbSignal())
      .maybeSingle();
    if (error) throw new Error("Unable to load enabled source");
    if (!data) return;
    const source = sourceSchema.parse(data);

    const batch = await this.ctx.storage.get<BatchState>("batch");
    if (!batch || batch.runKey !== initial.runKey || await this.pauseRequested()) return;
    const queued = batch.sources.slice(batch.index).some((item) => item.id === source.id);
    if (queued) return;
    const updated = { ...batch, sources: [...batch.sources, source] };
    await this.ctx.storage.put("batch", updated);
    await this.updatePublicState({
      queued_source_count: updated.sources.length - updated.index
    });
    if (updated.runId) {
      const { error: runError } = await adminDb(this.env)
        .from("scrape_runs")
        .update({ sources_total: updated.sources.length })
        .eq("id", updated.runId)
        .eq("status", "running")
        .abortSignal(dbSignal());
      if (runError) throw new Error("Unable to extend scrape run");
    }
  }

  async runNow(): Promise<SchedulerAction> {
    if (await this.pauseRequested()) return { accepted: false, state: await this.status() };
    const now = Date.now();
    const lock = await this.ctx.storage.get<RunLock>("runLock");
    const batch = await this.ctx.storage.get<BatchState>("batch");
    const nextBatchAt = await this.ctx.storage.get<number>("nextBatchAt");
    if (
      (lock !== undefined && lock.expiresAt > now)
      || batch !== undefined
      || (nextBatchAt !== undefined && nextBatchAt <= now + 1_000)
    ) {
      await this.ctx.storage.delete("runAfterCurrent");
      return { accepted: false, state: await this.status() };
    }

    if (lock) await this.ctx.storage.delete("runLock");
    await Promise.all([
      this.ctx.storage.put("nextBatchAt", now),
      this.ctx.storage.delete("runAfterCurrent")
    ]);
    await this.updatePublicState({
      status: "waiting",
      next_run_at: new Date(now).toISOString()
    });
    await this.scheduleNextAlarm();
    return { accepted: true, state: await this.status() };
  }

  override async alarm(): Promise<void> {
    await this.runNotificationPass();
    try {
      await this.runDueBatch();
    } catch (error) {
      console.error(JSON.stringify({ message: "scheduler batch failed", error: safeError(error) }));
      await this.handleBatchInfrastructureFailure(error);
    }
    try {
      await this.scheduleNextAlarm();
    } catch (error) {
      console.error(JSON.stringify({ message: "scheduler alarm scheduling failed", error: safeError(error) }));
      await this.ctx.storage.setAlarm(Date.now() + FAILURE_RETRY_MS);
    }
  }

  private async runNotificationPass(): Promise<void> {
    try {
      await processDueNotifications(this.env, 3);
    } catch {
      console.error(JSON.stringify({ message: "Telegram retry pass failed" }));
    }
  }

  private async runDueBatch(): Promise<void> {
    if (await this.pauseRequested()) return;
    const now = Date.now();
    const existingLock = await this.ctx.storage.get<RunLock>("runLock");
    if (existingLock && existingLock.expiresAt > now) return;
    if (existingLock) await this.ctx.storage.delete("runLock");

    let batch = await this.ctx.storage.get<BatchState>("batch");
    const nextBatchAt = await this.ctx.storage.get<number>("nextBatchAt");
    if (batch) {
      if (nextBatchAt !== undefined && nextBatchAt > now) return;
    } else if (nextBatchAt === undefined || nextBatchAt > now) {
      return;
    }

    const token = crypto.randomUUID();
    await this.ctx.storage.put<RunLock>("runLock", { token, expiresAt: now + LOCK_MS });
    try {
      if (!batch) {
        const created = await this.createBatch();
        if (created) batch = created;
      }
      if (!batch) {
        await this.releaseLock(token);
        return;
      }
      await this.processBatch(token, batch);
      await this.releaseLock(token);
    } catch (error) {
      const lock = await this.ctx.storage.get<RunLock>("runLock");
      if (lock?.token === token) {
        await this.ctx.storage.put<RunLock>("runLock", {
          token,
          expiresAt: Date.now() + FAILURE_RETRY_MS
        });
      }
      throw error;
    }
  }

  private async createBatch(): Promise<BatchState | null> {
    const { data, error } = await adminDb(this.env)
      .from("sources")
      .select("id, url, position")
      .eq("enabled", true)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .abortSignal(dbSignal());
    if (error) throw new Error("Unable to load enabled sources");
    const sources = z.array(sourceSchema).parse(data);
    if (sources.length === 0) {
      await Promise.all([
        this.ctx.storage.delete("nextBatchAt"),
        this.ctx.storage.put("pauseRequested", true),
        this.ctx.storage.put("noActiveStop", true)
      ]);
      await this.updatePublicState({
        status: "no_active_sources",
        pause_requested: true,
        pause_reason: "No active sources",
        current_source_id: null,
        current_source_position: null,
        queued_source_count: 0,
        next_run_at: null,
        active_run_id: null
      });
      return null;
    }

    const batch: BatchState = {
      runKey: `${SCHEDULER_NAME}:${crypto.randomUUID()}`,
      runId: null,
      sources,
      index: 0,
      startedAt: new Date().toISOString()
    };
    await this.ctx.storage.put("batch", batch);
    await this.ctx.storage.delete("nextBatchAt");
    return batch;
  }

  private async ensureRun(batch: BatchState): Promise<BatchState> {
    if (batch.runId) return batch;
    const db = adminDb(this.env);
    const { data: notificationData } = await db
      .from("telegram_bot_settings")
      .select("connected, notifications_enabled")
      .eq("singleton", true)
      .abortSignal(dbSignal())
      .maybeSingle();
    const notificationState = notificationStateSchema.safeParse(notificationData);
    const notificationsForcedOff = !notificationState.success
      || !notificationState.data.connected
      || !notificationState.data.notifications_enabled;
    const { error: insertError } = await db
      .from("scrape_runs")
      .upsert({
        run_key: batch.runKey,
        status: "running",
        forced_notifications_off: notificationsForcedOff,
        sources_total: batch.sources.length,
        started_at: batch.startedAt
      }, { onConflict: "run_key", ignoreDuplicates: true })
      .abortSignal(dbSignal());
    if (insertError) throw new Error("Unable to create scrape run");
    const { data, error } = await db
      .from("scrape_runs")
      .select("id")
      .eq("run_key", batch.runKey)
      .abortSignal(dbSignal())
      .single();
    const parsed = z.object({ id: z.string().uuid() }).safeParse(data);
    if (error || !parsed.success) throw new Error("Unable to load scrape run");
    const latest = await this.ctx.storage.get<BatchState>("batch");
    if (!latest || latest.runKey !== batch.runKey) throw new Error("Scrape batch changed");
    const withRun = { ...latest, runId: parsed.data.id };
    await this.ctx.storage.put("batch", withRun);
    if (withRun.sources.length !== batch.sources.length) {
      const { error: updateError } = await db
        .from("scrape_runs")
        .update({ sources_total: withRun.sources.length })
        .eq("id", withRun.runId)
        .abortSignal(dbSignal());
      if (updateError) throw new Error("Unable to extend scrape run");
    }
    await this.updatePublicState({
      status: "checking",
      pause_requested: false,
      pause_reason: null,
      queued_source_count: withRun.sources.length,
      next_run_at: null,
      active_run_id: withRun.runId
    });
    return withRun;
  }

  private async processBatch(token: string, initial: BatchState): Promise<void> {
    const batch = await this.ensureRun(initial);
    if (!batch.runId) throw new Error("Scrape run is missing ID");
    const runId = batch.runId;

    if (await this.pauseRequested()) {
      await this.pauseBatch(batch);
      return;
    }
    await this.refreshLock(token);
    const source = batch.sources[batch.index];
    if (!source) {
      await this.completeBatch(batch);
      return;
    }

    const completed = await this.completedSource(runId, source.id);
    const sourceEnabled = !completed && await this.sourceStillEnabled(source.id);
    if (!completed && !sourceEnabled) {
      const { error } = await adminDb(this.env).rpc("complete_source_scrape", {
        p_source_id: source.id,
        p_source_url: source.url,
        p_run_id: runId,
        p_observed_at: new Date().toISOString(),
        p_jobs: null
      }).abortSignal(dbSignal());
      if (error) throw new Error("Unable to close skipped source scrape");
    }
    if (!completed && sourceEnabled) {
      await this.updatePublicState({
        status: "checking",
        current_source_id: source.id,
        current_source_position: source.position,
        queued_source_count: batch.sources.length - batch.index - 1,
        active_run_id: runId
      });

      try {
        const jobs = await fetchSourceJobs(source.url);
        const observedAt = new Date().toISOString();
        const { error } = await adminDb(this.env).rpc("complete_source_scrape", {
          p_source_id: source.id,
          p_source_url: source.url,
          p_run_id: runId,
          p_observed_at: observedAt,
          p_jobs: jobs
        }).abortSignal(dbSignal());
        if (error) throw new Error("Unable to save source scrape");
      } catch (error) {
        const { data, error: failureError } = await adminDb(this.env).rpc("fail_source_scrape", {
          p_source_id: source.id,
          p_run_id: runId,
          p_category: "source",
          p_message: safeError(error)
        }).abortSignal(dbSignal());
        if (failureError) throw new Error("Unable to record source failure");
        const failureCount = z.number().int().nonnegative().parse(data);
        if (failureCount >= 3) await this.updatePublicState({ status: "error" });
      }
    }

    const latest = await this.ctx.storage.get<BatchState>("batch");
    if (!latest || latest.runKey !== batch.runKey) throw new Error("Scrape batch changed");
    const advanced = { ...latest, index: Math.max(latest.index, batch.index + 1) };
    await this.ctx.storage.put("batch", advanced);
    if (await this.pauseRequested()) {
      await this.pauseBatch(advanced);
      return;
    }
    if (advanced.index >= advanced.sources.length) {
      await this.completeBatch(advanced);
      return;
    }

    const continueAt = Date.now();
    await this.ctx.storage.put("nextBatchAt", continueAt);
    await this.updatePublicState({
      current_source_id: null,
      current_source_position: null,
      queued_source_count: advanced.sources.length - advanced.index,
      next_run_at: new Date(continueAt).toISOString()
    });
  }

  private async completedSource(runId: string, sourceId: string) {
    const { data, error } = await adminDb(this.env)
      .from("scrape_run_sources")
      .select("status")
      .eq("run_id", runId)
      .eq("source_id", sourceId)
      .abortSignal(dbSignal())
      .maybeSingle();
    if (error) throw new Error("Unable to inspect scrape progress");
    return data ? completedSourceSchema.parse(data) : null;
  }

  private async sourceStillEnabled(sourceId: string): Promise<boolean> {
    const { data, error } = await adminDb(this.env)
      .from("sources")
      .select("enabled")
      .eq("id", sourceId)
      .abortSignal(dbSignal())
      .maybeSingle();
    if (error) throw new Error("Unable to inspect source state");
    return z.object({ enabled: z.boolean() }).nullable().parse(data)?.enabled ?? false;
  }

  private async completeBatch(batch: BatchState): Promise<void> {
    if (!batch.runId) throw new Error("Scrape run is missing ID");
    const { data: completed, error: completedError } = await adminDb(this.env)
      .from("scrape_run_sources")
      .select("status")
      .eq("run_id", batch.runId)
      .abortSignal(dbSignal());
    if (completedError) throw new Error("Unable to finalize scrape run");
    const attempts = z.array(completedSourceSchema).parse(completed);
    const failures = attempts.filter((item) => item.status === "failed").length;
    const runStatus = failures === 0
      ? "succeeded"
      : failures === attempts.length && attempts.length > 0
        ? "failed"
        : "partial";
    const finishedAt = new Date().toISOString();
    const { error: runError } = await adminDb(this.env)
      .from("scrape_runs")
      .update({ status: runStatus, finished_at: finishedAt, sources_total: batch.sources.length })
      .eq("id", batch.runId)
      .eq("status", "running")
      .abortSignal(dbSignal());
    if (runError) throw new Error("Unable to finalize scrape run");

    const { count: sourceCount, error: sourceError } = await adminDb(this.env)
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("enabled", true)
      .abortSignal(dbSignal());
    if (sourceError) throw new Error("Unable to schedule next scrape run");
    if ((sourceCount ?? 0) === 0) {
      await Promise.all([
        this.ctx.storage.delete("nextBatchAt"),
        this.ctx.storage.put("pauseRequested", true),
        this.ctx.storage.put("noActiveStop", true)
      ]);
      await this.updatePublicState({
        status: "no_active_sources",
        pause_requested: true,
        pause_reason: "No active sources",
        current_source_id: null,
        current_source_position: null,
        queued_source_count: 0,
        last_check_at: finishedAt,
        next_run_at: null,
        active_run_id: null
      });
      await this.ctx.storage.delete("batch");
      return;
    }

    const runAfterCurrent = await this.ctx.storage.get<boolean>("runAfterCurrent");
    await Promise.all([
      this.ctx.storage.delete("runAfterCurrent"),
      this.ctx.storage.delete("noActiveStop")
    ]);
    const nextRun = runAfterCurrent ? Date.now() : Date.now() + randomDelayMs();
    await this.ctx.storage.put("nextBatchAt", nextRun);
    const { count: redCount, error: redError } = await adminDb(this.env)
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("enabled", true)
      .gte("failure_count", 3)
      .abortSignal(dbSignal());
    if (redError) throw new Error("Unable to load source health");
    await this.updatePublicState({
      status: (redCount ?? 0) > 0 ? "error" : "waiting",
      pause_requested: false,
      pause_reason: null,
      current_source_id: null,
      current_source_position: null,
      queued_source_count: 0,
      last_check_at: finishedAt,
      next_run_at: new Date(nextRun).toISOString(),
      active_run_id: null
    });
    await this.ctx.storage.delete("batch");
  }

  private async pauseBatch(batch: BatchState): Promise<void> {
    const stored = await this.readPublicState();
    const reason = stored.pause_reason ?? "Paused by admin";
    const noActiveStop = (await this.ctx.storage.get<boolean>("noActiveStop")) ?? false;
    await this.abandonBatch(batch);
    await this.updatePublicState({
      status: noActiveStop ? "no_active_sources" : "paused",
      pause_requested: true,
      pause_reason: reason,
      current_source_id: null,
      current_source_position: null,
      queued_source_count: 0,
      next_run_at: null,
      active_run_id: null
    });
    await this.ctx.storage.delete("batch");
  }

  private async abandonBatch(batch: BatchState): Promise<void> {
    await this.ctx.storage.put("batch", { ...batch, index: batch.sources.length });
    if (batch.runId) {
      const { error } = await adminDb(this.env)
        .from("scrape_runs")
        .update({ status: "partial", finished_at: new Date().toISOString() })
        .eq("id", batch.runId)
        .eq("status", "running")
        .abortSignal(dbSignal());
      if (error) throw new Error("Unable to stop scrape run");
    }
  }

  private async pauseRequested(): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>("pauseRequested")) ?? true;
  }

  private async refreshLock(token: string): Promise<void> {
    const lock = await this.ctx.storage.get<RunLock>("runLock");
    if (lock?.token !== token) throw new Error("Scheduler lock lost");
    await this.ctx.storage.put<RunLock>("runLock", { token, expiresAt: Date.now() + LOCK_MS });
  }

  private async releaseLock(token: string): Promise<void> {
    const lock = await this.ctx.storage.get<RunLock>("runLock");
    if (lock?.token === token) await this.ctx.storage.delete("runLock");
  }

  private async handleBatchInfrastructureFailure(error: unknown): Promise<void> {
    const batch = await this.ctx.storage.get<BatchState>("batch");
    const retryAt = Date.now() + FAILURE_RETRY_MS;
    if (batch) await this.ctx.storage.put("nextBatchAt", retryAt);
    try {
      await this.updatePublicState({
        status: "error",
        pause_reason: safeError(error),
        next_run_at: batch ? new Date(retryAt).toISOString() : null
      });
    } catch (stateError) {
      console.error(JSON.stringify({ message: "scheduler state update failed", error: safeError(stateError) }));
    }
  }

  private async readPublicState() {
    const { data, error } = await adminDb(this.env)
      .from("scraper_state")
      .select(
        "status, pause_requested, pause_reason, current_source_id, current_source_position, queued_source_count, last_check_at, next_run_at, active_run_id, updated_at"
      )
      .eq("singleton", true)
      .abortSignal(dbSignal())
      .single();
    if (error) throw new Error("Unable to load scheduler state");
    return stateSchema.parse(data);
  }

  private async updatePublicState(values: StateUpdate): Promise<void> {
    const { error } = await adminDb(this.env)
      .from("scraper_state")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("singleton", true)
      .abortSignal(dbSignal());
    if (error) throw new Error("Unable to update scheduler state");
  }

  private async scheduleNextAlarm(): Promise<void> {
    const [nextBatchAt, retryAt, lock, batch] = await Promise.all([
      this.ctx.storage.get<number>("nextBatchAt"),
      nextNotificationRetryAt(this.env),
      this.ctx.storage.get<RunLock>("runLock"),
      this.ctx.storage.get<BatchState>("batch")
    ]);
    const now = Date.now();
    const batchAt = batch
      ? nextBatchAt !== undefined && nextBatchAt > now
        ? nextBatchAt
        : lock && lock.expiresAt > now
          ? lock.expiresAt
          : now
      : nextBatchAt ?? null;
    const candidates = [
      batchAt,
      retryAt,
      lock && lock.expiresAt > now ? lock.expiresAt : null
    ].filter((value): value is number => value !== null && Number.isFinite(value));
    if (candidates.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.max(now + 1000, Math.min(...candidates)));
  }
}
