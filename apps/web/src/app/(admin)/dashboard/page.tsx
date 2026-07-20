"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConfirmDialog, EmptyState, ErrorState, JobList, LoadingState, Notice, StatusPill } from "@/components/ui";
import { api } from "@/lib/api";
import { dashboardSchema, type Dashboard } from "@/lib/contracts";
import { formatDhaka, formatRelative } from "@/lib/format";

const statusCopy = {
  waiting: ["Waiting", "good"],
  checking: ["Checking sources", "good"],
  pausing: ["Pausing", "warn"],
  paused: ["Paused", "warn"],
  no_active_sources: ["No active sources", "warn"],
  error: ["Needs attention", "bad"]
} as const;

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard>();
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [acting, setActing] = useState(false);

  async function load(signal?: AbortSignal) {
    try {
      const next = dashboardSchema.parse(await api("/api/dashboard", { signal }));
      setError("");
      setData(next);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Dashboard request failed");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void api("/api/dashboard", { signal: controller.signal })
      .then((value) => dashboardSchema.parse(value))
      .then((next) => {
        setError("");
        setData(next);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Dashboard request failed");
      });
    return () => controller.abort();
  }, []);

  if (!data && !error) return <LoadingState label="Loading dashboard" />;
  if (!data) return <ErrorState message={error} retry={() => void load()} />;

  const paused = data.scheduler.status === "paused" || data.scheduler.status === "no_active_sources";
  const [statusLabel, statusTone] = statusCopy[data.scheduler.status];

  async function changeScheduler() {
    if (!data) return;
    const action = paused ? "resume" : "pause";
    setConfirming(false);
    setActing(true);
    setActionError("");
    if (action === "pause") {
      setData({ ...data, scheduler: { ...data.scheduler, status: "pausing" } });
    }
    try {
      await api(`/api/scheduler/${action}`, { method: "POST", body: "{}" });
      await load();
    } catch (mutationError) {
      setActionError(mutationError instanceof Error ? mutationError.message : "Scheduler update failed");
      await load();
    } finally {
      setActing(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Dhaka operations</p>
          <h1>Dashboard</h1>
          <p>Stored job activity, delivery audience, and scraper health.</p>
        </div>
        <time className="date-stamp">
          {new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Dhaka",
            weekday: "long",
            day: "numeric",
            month: "long"
          }).format(new Date())}
        </time>
      </div>

      {actionError || error ? <Notice>{actionError || error}</Notice> : null}

      <section className="metric-grid" aria-label="Dashboard summary">
        <article className="metric-card metric-primary">
          <span className="metric-label">Today</span>
          <strong>{data.todayJobs}</strong>
          <span>Unique jobs after baseline, Dhaka day</span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Bot users</span>
          <strong>{data.botUsers.total}</strong>
          <span>
            {data.botUsers.on} On / {data.botUsers.off} Off / {data.botUsers.pending} Pending
          </span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Active sources</span>
           <strong>{data.activeSources} / {data.totalSources}</strong>
           <span>Enabled / total sources</span>
        </article>
        <button
          className="metric-card scheduler-card"
          type="button"
          disabled={acting || data.scheduler.status === "pausing"}
          onClick={() => setConfirming(true)}
        >
          <span className="scheduler-topline">
            <span className="metric-label">Scraper</span>
            <StatusPill tone={statusTone}>{acting && !paused ? "Pausing" : statusLabel}</StatusPill>
          </span>
          <strong className="scheduler-action">{paused ? "Resume checks" : "Pause checks"}</strong>
          <span>Last: {formatRelative(data.scheduler.lastCheckAt)}</span>
          <span>Next: {paused ? statusLabel : formatRelative(data.scheduler.nextRunAt)}</span>
        </button>
      </section>

      <div className="check-times">
        <div>
          <span>Last completed check</span>
          <strong>{formatDhaka(data.scheduler.lastCheckAt)}</strong>
        </div>
        <div>
          <span>Next scheduled check</span>
          <strong>{paused ? statusLabel : formatDhaka(data.scheduler.nextRunAt)}</strong>
        </div>
      </div>

      <section aria-labelledby="latest-jobs">
        <div className="section-heading">
          <h2 id="latest-jobs">Latest jobs</h2>
          <Link href="/jobs">View all</Link>
        </div>
        {data.latestJobs.length ? (
          <JobList jobs={data.latestJobs} />
        ) : (
          <EmptyState title="No stored jobs">New non-baseline jobs will appear after checks run.</EmptyState>
        )}
      </section>

      <ConfirmDialog
        open={confirming}
        busy={acting}
        title={paused ? "Resume source checks?" : "Pause source checks?"}
        confirmLabel={paused ? "Resume checks" : "Pause checks"}
        onClose={() => setConfirming(false)}
        onConfirm={() => void changeScheduler()}
      >
        <p>
          {paused
            ? data.scheduler.status === "no_active_sources"
              ? "Enable at least one source first. Resume then starts a fresh scheduler wait."
              : "Checks resume on scheduler timing. Existing stored jobs stay unchanged."
            : "Current source finishes safely, then scheduler pauses. Stored jobs stay unchanged."}
        </p>
      </ConfirmDialog>
    </>
  );
}
