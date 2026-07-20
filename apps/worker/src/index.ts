import {
  dhakaDayStart,
  sourceCreateSchema,
  sourceReorderSchema,
  sourceUpdateSchema,
  subscriberUpdateSchema,
  telegramTokenSchema
} from "@project-g/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import {
  adminFromRequest,
  enrollMfa,
  login,
  logout,
  refreshSession,
  updateRecoveredPassword,
  verifyMfa,
  verifyRecovery
} from "./auth";
import { hmac, secureEqual } from "./lib/crypto";
import { adminDb } from "./lib/db";
import { parseJson } from "./lib/http";
import { getSchedulerStub, SchedulerCoordinator } from "./scheduler";
import { scrapeSource } from "./scraper";
import {
  botStatus,
  connectBot,
  disconnectBot,
  handleTelegramWebhook,
  listSubscribers,
  sendTest,
  setMasterNotifications,
  setSubscriberStatus,
  type TelegramBotStatus,
  type TelegramSubscriber
} from "./telegram";

export { SchedulerCoordinator };

type AppEnv = { Bindings: Env };

const DB_TIMEOUT_MS = 10_000;
const SOURCE_COLUMNS =
  "id, url, normalized_url, enabled, position, baseline_completed, last_checked_at, last_failed_at, failure_count, last_error";
const JOB_COLUMNS =
  "job_id, name, done_count, total_target, payment, details_url, source_url, first_seen_at";

const uuidSchema = z.string().uuid();
const sourceRowSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  normalized_url: z.string().url(),
  enabled: z.boolean(),
  position: z.number().int().nonnegative(),
  baseline_completed: z.boolean(),
  last_checked_at: z.string().nullable(),
  last_failed_at: z.string().nullable(),
  failure_count: z.number().int().nonnegative(),
  last_error: z.string().nullable()
});
const jobRowSchema = z.object({
  job_id: z.string().min(1),
  name: z.string().min(1),
  done_count: z.number().int().nonnegative(),
  total_target: z.number().int().positive(),
  payment: z.string().min(1),
  details_url: z.string().url(),
  source_url: z.string().url(),
  first_seen_at: z.string().min(1)
});
const schedulerRowSchema = z.object({
  status: z.enum(["waiting", "checking", "pausing", "paused", "no_active_sources", "error"]),
  last_check_at: z.string().nullable(),
  next_run_at: z.string().nullable()
});
const botSettingsRowSchema = z.object({
  connected: z.boolean(),
  bot_id: z.number().int().nullable()
});
const cursorSchema = z.object({
  t: z.string().datetime({ offset: true }).max(64),
  id: z.string().regex(/^\d+$/)
}).strict();

type SourceRow = z.infer<typeof sourceRowSchema>;
type JobRow = z.infer<typeof jobRowSchema>;
type AuditMetadata = Record<string, string | number | boolean | null>;
type SchedulerSignals = {
  sourceEnabled?: (sourceId: string) => Promise<unknown>;
  stopForNoActiveSources?: () => Promise<unknown>;
};

function dbSignal(): AbortSignal {
  return AbortSignal.timeout(DB_TIMEOUT_MS);
}

function sourceJson(row: SourceRow) {
  return {
    id: row.id,
    url: row.url,
    normalizedUrl: row.normalized_url,
    enabled: row.enabled,
    position: row.position,
    baselineCompleted: row.baseline_completed,
    lastCheckedAt: row.last_checked_at,
    lastFailedAt: row.last_failed_at,
    failureCount: row.failure_count,
    lastError: row.last_error
  };
}

function jobJson(row: JobRow) {
  return {
    jobId: row.job_id,
    name: row.name,
    doneCount: row.done_count,
    totalTarget: row.total_target,
    payment: row.payment,
    detailsUrl: row.details_url,
    sourceUrl: row.source_url,
    firstSeenAt: row.first_seen_at
  };
}

function botJson(status: TelegramBotStatus) {
  if (!status.connected) return { connected: false as const };
  if (!status.identity || !status.token) throw new Error("Telegram connection is incomplete");
  return {
    connected: true as const,
    identity: {
      displayName: status.identity.displayName,
      username: status.identity.username ?? status.identity.id,
      avatarUrl: status.identity.avatarUrl
    },
    masterEnabled: status.notificationsEnabled,
    maskedToken: status.token
  };
}

function subscriberJson(subscriber: TelegramSubscriber) {
  const username = subscriber.username?.trim() || null;
  const displayName = [subscriber.firstName, subscriber.lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ") || username || "Telegram user";
  return { id: subscriber.id, displayName, username, status: subscriber.status };
}

function uuidParam(value: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new HTTPException(400, { message: "Invalid ID" });
  return parsed.data;
}

function decodeCursor(value: string | null): z.infer<typeof cursorSchema> | null {
  if (value === null) return null;
  if (value.length === 0 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new HTTPException(400, { message: "Invalid cursor" });
  }
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const parsed = cursorSchema.safeParse(
      JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))))
    );
    if (!parsed.success) throw new Error("invalid cursor");
    return parsed.data;
  } catch {
    throw new HTTPException(400, { message: "Invalid cursor" });
  }
}

function encodeCursor(row: JobRow): string {
  return btoa(JSON.stringify({ t: row.first_seen_at, id: row.job_id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function safeClientIp(value: string | undefined): string {
  if (!value || value !== value.trim() || value.length > 45) return "unknown";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    const parts = value.split(".");
    if (parts.every((part) => String(Number(part)) === part && Number(part) <= 255)) return value;
    return "unknown";
  }
  if (!value.includes(":") || !/^[0-9A-Fa-f:.]+$/.test(value)) return "unknown";
  try {
    new URL(`http://[${value}]/`);
    return value.toLowerCase();
  } catch {
    return "unknown";
  }
}

async function validInternalSecret(supplied: string, expected: string): Promise<boolean> {
  return secureEqual(supplied, expected);
}

async function enforceMutationLimit(
  env: Env,
  userId: string,
  endpoint: string,
  limit = 30,
  windowSeconds = 60
): Promise<void> {
  const keyHash = await hmac(`admin-mutation\0${userId}\0${endpoint}`, env.SECURITY_HMAC_KEY);
  const { data, error } = await adminDb(env)
    .rpc("consume_rate_limit", {
      p_key_hash: keyHash,
      p_window_seconds: windowSeconds,
      p_limit: limit
    })
    .abortSignal(dbSignal());
  if (error || typeof data !== "boolean") throw new Error("Unable to enforce rate limit");
  if (!data) throw new HTTPException(429, { message: "Too many requests" });
}

async function audit(
  env: Env,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: AuditMetadata = {}
): Promise<void> {
  try {
    const { error } = await adminDb(env)
      .from("audit_log")
      .insert({
        actor_id: actorId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        metadata
      })
      .abortSignal(dbSignal());
    if (error) throw new Error("audit insert failed");
  } catch {
    console.error(JSON.stringify({ message: "audit write failed", action }));
  }
}

async function validateLiveSource(url: string) {
  try {
    return await scrapeSource(url);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Source validation failed";
    throw new HTTPException(400, { message });
  }
}

async function loadSource(env: Env, id: string): Promise<SourceRow> {
  const { data, error } = await adminDb(env)
    .from("sources")
    .select(SOURCE_COLUMNS)
    .eq("id", id)
    .abortSignal(dbSignal())
    .maybeSingle();
  if (error) throw new Error("Unable to load source");
  if (!data) throw new HTTPException(404, { message: "Source not found" });
  return sourceRowSchema.parse(data);
}

function schedulerWithSignals(env: Env): ReturnType<typeof getSchedulerStub> & SchedulerSignals {
  return getSchedulerStub(env);
}

async function notifySourceEnabled(env: Env, sourceId: string): Promise<void> {
  if (!("sourceEnabled" in SchedulerCoordinator.prototype)) return;
  await schedulerWithSignals(env).sourceEnabled?.(sourceId);
}

async function stopSchedulerWithoutSources(env: Env): Promise<void> {
  if (!("stopForNoActiveSources" in SchedulerCoordinator.prototype)) return;
  const { count, error } = await adminDb(env)
    .from("sources")
    .select("id", { count: "exact", head: true })
    .eq("enabled", true)
    .abortSignal(dbSignal());
  if (error) throw new Error("Unable to count enabled sources");
  if ((count ?? 0) === 0) await schedulerWithSignals(env).stopForNoActiveSources?.();
}

async function dashboard(env: Env) {
  const db = adminDb(env);
  const [today, totalSources, activeSources, state, latestJobs, botSettings] = await Promise.all([
    db
      .from("jobs")
      .select("job_id", { count: "exact", head: true })
      .eq("dhaka_day", dhakaDayStart().slice(0, 10))
      .eq("is_baseline", false)
      .abortSignal(dbSignal()),
    db.from("sources").select("id", { count: "exact", head: true }).abortSignal(dbSignal()),
    db
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("enabled", true)
      .abortSignal(dbSignal()),
    db
      .from("scraper_state")
      .select("status, last_check_at, next_run_at")
      .eq("singleton", true)
      .abortSignal(dbSignal())
      .single(),
    db
      .from("jobs")
      .select(JOB_COLUMNS)
      .order("first_seen_at", { ascending: false })
      .order("job_id", { ascending: false })
      .limit(10)
      .abortSignal(dbSignal()),
    db
      .from("telegram_bot_settings")
      .select("connected, bot_id")
      .eq("singleton", true)
      .abortSignal(dbSignal())
      .single()
  ]);
  if (
    today.error ||
    totalSources.error ||
    activeSources.error ||
    state.error ||
    latestJobs.error ||
    botSettings.error
  ) {
    throw new Error("Unable to load dashboard");
  }

  const storedState = schedulerRowSchema.parse(state.data);
  const storedBot = botSettingsRowSchema.parse(botSettings.data);
  const botUsers = { total: 0, on: 0, off: 0, pending: 0 };
  if (storedBot.connected) {
    if (storedBot.bot_id === null) throw new Error("Telegram connection is incomplete");
    const current = (query: ReturnType<typeof adminDb>) => query
      .from("telegram_subscribers")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", storedBot.bot_id)
      .is("archived_at", null);
    const [all, on, pending] = await Promise.all([
      current(adminDb(env)).abortSignal(dbSignal()),
      current(adminDb(env)).eq("status", "active").eq("disabled_by_admin", false).abortSignal(dbSignal()),
      current(adminDb(env)).eq("status", "pending").abortSignal(dbSignal())
    ]);
    if (all.error || on.error || pending.error) throw new Error("Unable to load bot users");
    botUsers.total = all.count ?? 0;
    botUsers.on = on.count ?? 0;
    botUsers.pending = pending.count ?? 0;
    botUsers.off = Math.max(0, botUsers.total - botUsers.on - botUsers.pending);
  }

  return {
    todayJobs: today.count ?? 0,
    botUsers,
    activeSources: activeSources.count ?? 0,
    totalSources: totalSources.count ?? 0,
    scheduler: {
      status: storedState.status,
      lastCheckAt: storedState.last_check_at,
      nextRunAt: storedState.next_run_at
    },
    latestJobs: z.array(jobRowSchema).parse(latestJobs.data).map(jobJson)
  };
}

const app = new Hono<AppEnv>();

app.use("*", secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'none'"],
    frameAncestors: ["'none'"]
  },
  permissionsPolicy: { camera: [], geolocation: [], microphone: [] },
  strictTransportSecurity: "max-age=63072000; includeSubDomains",
  xFrameOptions: "DENY"
}));
app.use("*", async (context, next) => {
  await next();
  context.header("Cache-Control", "no-store, max-age=0");
  context.header("Pragma", "no-cache");
  context.header("X-Robots-Tag", "noindex, nofollow, nosnippet");
});
app.use("/api/*", async (context, next) => cors({
  origin: context.env.CORS_ORIGIN,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: [
    "Authorization",
    "Content-Type",
    "X-Browser-Id",
    "X-Client-Ip",
    "X-Internal-Api-Secret"
  ],
  maxAge: 600
})(context, next));
app.use("/api/*", async (context, next) => {
  if (!context.env.INTERNAL_API_SECRET) throw new Error("Internal API secret is not configured");
  const valid = await validInternalSecret(
    context.req.header("x-internal-api-secret") ?? "",
    context.env.INTERNAL_API_SECRET
  );
  if (!valid) return context.json({ error: "Unauthorized" }, 401);
  await next();
});

app.get("/health", (context) => context.json({ ok: true }));
app.all("/telegram/webhook", (context) =>
  handleTelegramWebhook(context.env, context.req.raw)
);

app.post("/api/auth/login", (context) =>
  login(context, safeClientIp(context.req.header("x-client-ip")))
);
app.post("/api/auth/mfa/enroll", enrollMfa);
app.post("/api/auth/mfa/verify", verifyMfa);
app.post("/api/auth/refresh", refreshSession);
app.post("/api/auth/logout", logout);
app.post("/api/auth/recovery/verify", verifyRecovery);
app.post("/api/auth/recovery/password", updateRecoveredPassword);
app.get("/api/auth/me", async (context) => {
  const admin = await adminFromRequest(context, true);
  return context.json({ id: admin.userId, email: admin.email, aal: admin.aal });
});

app.get("/api/dashboard", async (context) => {
  await adminFromRequest(context, true);
  return context.json(await dashboard(context.env));
});

app.post("/api/scheduler/pause", async (context) => {
  const admin = await adminFromRequest(context, true);
  await enforceMutationLimit(context.env, admin.userId, "scheduler.pause", 10);
  const result = await getSchedulerStub(context.env).requestPause("Paused by admin");
  await audit(context.env, admin.userId, "scheduler.pause", "scheduler", "scheduler-v1");
  return context.json(result);
});

app.post("/api/scheduler/resume", async (context) => {
  const admin = await adminFromRequest(context, true);
  await enforceMutationLimit(context.env, admin.userId, "scheduler.resume", 10);
  const result = await getSchedulerStub(context.env).resume();
  await audit(context.env, admin.userId, "scheduler.resume", "scheduler", "scheduler-v1");
  return context.json(result);
});

app.get("/api/sources", async (context) => {
  await adminFromRequest(context, true);
  const { data, error } = await adminDb(context.env)
    .from("sources")
    .select(SOURCE_COLUMNS)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .abortSignal(dbSignal());
  if (error) throw new Error("Unable to load sources");
  return context.json({ sources: z.array(sourceRowSchema).parse(data).map(sourceJson) });
});

app.post("/api/sources/test", async (context) => {
  await adminFromRequest(context, true);
  const { url } = await parseJson(context, sourceCreateSchema);
  const jobs = await validateLiveSource(url);
  return context.json({ ok: true, jobsFound: jobs.length });
});

app.post("/api/sources", async (context) => {
  const admin = await adminFromRequest(context, true);
  const { url } = await parseJson(context, sourceCreateSchema);
  await validateLiveSource(url);
  await enforceMutationLimit(context.env, admin.userId, "source.create");
  const db = adminDb(context.env);
  const { data: last, error: positionError } = await db
    .from("sources")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .abortSignal(dbSignal())
    .maybeSingle();
  if (positionError) throw new Error("Unable to append source");
  const lastPosition = z.object({ position: z.number().int().nonnegative() }).nullable().parse(last);
  const { data, error } = await db
    .from("sources")
    .insert({
      url,
      normalized_url: url,
      enabled: false,
      position: (lastPosition?.position ?? 0) + 1
    })
    .select(SOURCE_COLUMNS)
    .abortSignal(dbSignal())
    .single();
  if (error?.code === "23505") throw new HTTPException(409, { message: "Source already exists" });
  if (error) throw new Error("Unable to create source");
  const source = sourceRowSchema.parse(data);
  await audit(context.env, admin.userId, "source.create", "source", source.id);
  return context.json({ source: sourceJson(source) }, 201);
});

app.patch("/api/sources/:id", async (context) => {
  const admin = await adminFromRequest(context, true);
  const id = uuidParam(context.req.param("id"));
  const input = await parseJson(context, sourceUpdateSchema);
  const current = await loadSource(context.env, id);
  const changes: {
    url?: string;
    normalized_url?: string;
    enabled?: boolean;
    baseline_completed?: boolean;
    updated_at: string;
  } = { updated_at: new Date().toISOString() };
  const urlChanged = input.url !== undefined && input.url !== current.normalized_url;
  if (urlChanged && input.url !== undefined) {
    await validateLiveSource(input.url);
    changes.url = input.url;
    changes.normalized_url = input.url;
    changes.baseline_completed = false;
  }
  if (input.enabled !== undefined && input.enabled !== current.enabled) changes.enabled = input.enabled;
  await enforceMutationLimit(context.env, admin.userId, "source.update");
  if (!urlChanged && changes.enabled === undefined) {
    if (input.enabled === true) await notifySourceEnabled(context.env, id);
    if (input.enabled === false) await stopSchedulerWithoutSources(context.env);
    return context.json({ source: sourceJson(current) });
  }

  const { data, error } = await adminDb(context.env)
    .from("sources")
    .update(changes)
    .eq("id", id)
    .select(SOURCE_COLUMNS)
    .abortSignal(dbSignal())
    .maybeSingle();
  if (error?.code === "23505") throw new HTTPException(409, { message: "Source already exists" });
  if (error) throw new Error("Unable to update source");
  if (!data) throw new HTTPException(404, { message: "Source not found" });
  const updated = sourceRowSchema.parse(data);
  await audit(context.env, admin.userId, "source.update", "source", id, {
    urlChanged,
    enabled: updated.enabled
  });
  if (!current.enabled && updated.enabled) await notifySourceEnabled(context.env, id);
  if (current.enabled && !updated.enabled) await stopSchedulerWithoutSources(context.env);
  return context.json({ source: sourceJson(updated) });
});

app.delete("/api/sources/:id", async (context) => {
  const admin = await adminFromRequest(context, true);
  await enforceMutationLimit(context.env, admin.userId, "source.delete");
  const id = uuidParam(context.req.param("id"));
  await loadSource(context.env, id);
  const { data, error } = await adminDb(context.env)
    .from("sources")
    .delete()
    .eq("id", id)
    .select("id")
    .abortSignal(dbSignal())
    .maybeSingle();
  if (error) throw new Error("Unable to delete source");
  if (!data) throw new HTTPException(404, { message: "Source not found" });
  await audit(context.env, admin.userId, "source.delete", "source", id);
  await stopSchedulerWithoutSources(context.env);
  return context.json({ ok: true });
});

app.put("/api/sources/order", async (context) => {
  const admin = await adminFromRequest(context, true);
  await enforceMutationLimit(context.env, admin.userId, "source.reorder");
  const { ids } = await parseJson(context, sourceReorderSchema);
  const { data, error } = await adminDb(context.env)
    .from("sources")
    .select("id")
    .abortSignal(dbSignal());
  if (error) throw new Error("Unable to validate source order");
  const storedIds = z.array(z.object({ id: z.string().uuid() })).parse(data).map((row) => row.id);
  const supplied = new Set(ids);
  if (ids.length !== storedIds.length || supplied.size !== ids.length || storedIds.some((id) => !supplied.has(id))) {
    throw new HTTPException(400, { message: "Source order must include every source exactly once" });
  }
  const { error: reorderError } = await adminDb(context.env)
    .rpc("reorder_sources", { p_source_ids: ids })
    .abortSignal(dbSignal());
  if (reorderError) throw new Error("Unable to reorder sources");
  await audit(context.env, admin.userId, "source.reorder", "source", null, { count: ids.length });
  return context.json({ ok: true });
});

app.get("/api/jobs", async (context) => {
  await adminFromRequest(context, true);
  const url = new URL(context.req.url);
  if (url.searchParams.getAll("q").length > 1 || url.searchParams.getAll("cursor").length > 1) {
    throw new HTTPException(400, { message: "Invalid query" });
  }
  const query = (url.searchParams.get("q") ?? "").trim();
  if (query.length > 120) throw new HTTPException(400, { message: "Search query is too long" });
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const { data, error } = await adminDb(context.env)
    .rpc("list_jobs", {
      p_query: query || null,
      p_cursor_time: cursor?.t ?? null,
      p_cursor_job_id: cursor?.id ?? null,
      p_limit: 26
    })
    .abortSignal(dbSignal());
  if (error) throw new Error("Unable to load jobs");
  const rows = z.array(jobRowSchema).parse(data);
  const jobs = rows.slice(0, 25);
  const last = jobs.at(-1);
  return context.json({
    jobs: jobs.map(jobJson),
    nextCursor: rows.length === 26 && last ? encodeCursor(last) : null
  });
});

app.get("/api/bot", async (context) => {
  await adminFromRequest(context, true);
  return context.json(botJson(await botStatus(context.env)));
});

app.post("/api/bot/connect", async (context) => {
  const admin = await adminFromRequest(context, true);
  await enforceMutationLimit(context.env, admin.userId, "bot.connect", 5, 600);
  const { token } = await parseJson(context, telegramTokenSchema);
  let status: TelegramBotStatus;
  try {
    status = await connectBot(context.env, token);
  } catch (error) {
    if (error instanceof Error && error.name === "TelegramApiError") {
      const temporary = error.message.toLowerCase().includes("temporar") || error.message.includes("unknown");
      throw new HTTPException(temporary ? 502 : 400, {
        message: temporary ? "Telegram is temporarily unavailable" : "Telegram rejected bot token"
      });
    }
    throw error;
  }
  await audit(context.env, admin.userId, "bot.connect", "telegram_bot", status.identity?.id ?? null);
  return context.json(botJson(status));
});

app.post("/api/bot/disconnect", async (context) => {
  const admin = await adminFromRequest(context, true);
  await enforceMutationLimit(context.env, admin.userId, "bot.disconnect", 5, 600);
  await disconnectBot(context.env);
  await audit(context.env, admin.userId, "bot.disconnect", "telegram_bot", null);
  return context.json({ connected: false as const });
});

app.post("/api/bot/test", async (context) => {
  const admin = await adminFromRequest(context, true);
  await enforceMutationLimit(context.env, admin.userId, "bot.test", 10, 300);
  const subscriber = (await listSubscribers(context.env)).find(
    (item) => item.status === "active" && !item.disabledByAdmin
  );
  if (!subscriber) throw new HTTPException(400, { message: "No active subscriber available" });
  const result = await sendTest(context.env, subscriber.id);
  await audit(context.env, admin.userId, "bot.test", "telegram_subscriber", subscriber.id);
  return context.json(result);
});

app.patch("/api/bot/master", async (context) => {
  const admin = await adminFromRequest(context, true);
  await enforceMutationLimit(context.env, admin.userId, "bot.master");
  const { enabled } = await parseJson(context, subscriberUpdateSchema);
  if (!(await botStatus(context.env)).connected) {
    throw new HTTPException(409, { message: "Telegram bot is not connected" });
  }
  const result = await setMasterNotifications(context.env, enabled);
  await audit(context.env, admin.userId, "bot.master", "telegram_bot", null, { enabled });
  return context.json(result);
});

app.get("/api/bot/subscribers", async (context) => {
  await adminFromRequest(context, true);
  return context.json({
    subscribers: (await listSubscribers(context.env)).map(subscriberJson)
  });
});

app.patch("/api/bot/subscribers/:id", async (context) => {
  const admin = await adminFromRequest(context, true);
  await enforceMutationLimit(context.env, admin.userId, "subscriber.update");
  const id = uuidParam(context.req.param("id"));
  const { enabled } = await parseJson(context, subscriberUpdateSchema);
  let subscriber: TelegramSubscriber;
  try {
    subscriber = await setSubscriberStatus(context.env, id, enabled);
  } catch (error) {
    if (error instanceof Error && error.message === "Telegram subscriber not found") {
      throw new HTTPException(404, { message: "Subscriber not found" });
    }
    if (error instanceof Error && error.message === "Telegram bot is not connected") {
      throw new HTTPException(409, { message: error.message });
    }
    throw error;
  }
  await audit(context.env, admin.userId, "subscriber.update", "telegram_subscriber", id, { enabled });
  return context.json({ subscriber: subscriberJson(subscriber) });
});

app.notFound((context) => context.json({ error: "Not found" }, 404));
app.onError((error, context) => {
  if (error instanceof HTTPException) {
    return context.json({ error: error.message }, error.status);
  }
  let route = "unknown";
  try {
    route = context.req.routePath;
  } catch {
    // Route metadata is optional during framework-level failures.
  }
  console.error(JSON.stringify({
    message: "request failed",
    method: context.req.method,
    route,
    error: error instanceof Error ? error.name : typeof error
  }));
  return context.json({ error: "Internal server error" }, 500);
});

export default app;
