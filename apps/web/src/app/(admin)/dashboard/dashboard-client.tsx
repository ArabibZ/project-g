"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, ConfirmDialog, EmptyState, IconInbox, JobList, Notice, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { dashboardSchema, type Dashboard } from "@/lib/contracts";
import { formatDhaka, formatRelative } from "@/lib/format";

/* Formal status labels + tones (unchanged product terminology) and the
   hero's human headline for each scheduler state. */
const statusMeta = {
  waiting: {
    label: "Waiting",
    headline: "All quiet.",
    tone: "accent",
    note: "Scraper is idle until the next scheduled check."
  },
  checking: {
    label: "Checking sources",
    headline: "Scanning now…",
    tone: "accent",
    pulse: true,
    note: "Fetching enabled sources for new jobs right now."
  },
  pausing: {
    label: "Pausing",
    headline: "Wrapping up…",
    tone: "warn",
    pulse: true,
    note: "Finishing the current source safely, then pausing."
  },
  paused: {
    label: "Paused",
    headline: "On a break.",
    tone: "warn",
    hollow: true,
    note: "Checks are paused. Stored jobs stay unchanged."
  },
  no_active_sources: {
    label: "No active sources",
    headline: "Nothing to watch.",
    tone: "warn",
    note: "Every source is Off. Enable at least one source to check again."
  },
  error: {
    label: "Needs attention",
    headline: "Something's off.",
    tone: "bad",
    note: "The last scheduler run failed. Pause and resume to restart it."
  }
} as const;

export function DashboardClient({
  initialData,
  initialNow
}: {
  initialData: Dashboard;
  initialNow: number;
}) {
  const [data, setData] = useState(initialData);
  const [referenceNow, setReferenceNow] = useState(initialNow);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [acting, setActing] = useState(false);

  async function load() {
    try {
      const next = dashboardSchema.parse(await api("/api/dashboard"));
      setError("");
      setData(next);
      setReferenceNow(Date.now());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Dashboard request failed");
    }
  }

  const paused = data.scheduler.status === "paused" || data.scheduler.status === "no_active_sources";
  const meta = statusMeta[data.scheduler.status];

  async function changeScheduler() {
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
      <section className="hero" aria-label="Scraper scheduler">
        <div className="hero-main">
          <div className="hero-topline">
            <p className="microlabel">Scraper · Asia/Dhaka</p>
            <Pill
              tone={meta.tone}
              pulse={"pulse" in meta && meta.pulse}
              hollow={"hollow" in meta && meta.hollow}
            >
              {acting && !paused ? "Pausing" : meta.label}
            </Pill>
          </div>
          <h1 className="hero-title" role="status">
            {meta.headline.slice(0, -1)}
            <span className="tick">{meta.headline.slice(-1)}</span>
          </h1>
          <p className="hero-note">
            {meta.note}
            {data.scheduler.status === "no_active_sources" ? (
              <>
                {" "}
                <Link className="link" href="/sources" prefetch={false}>
                  Manage sources
                </Link>
              </>
            ) : null}
          </p>
        </div>

        <div className="hero-side">
          <div className="hero-times">
            <div>
              <span className="microlabel">Last completed check</span>
              <strong>{formatRelative(data.scheduler.lastCheckAt, referenceNow)}</strong>
              <span className="abs">{formatDhaka(data.scheduler.lastCheckAt)}</span>
            </div>
            <div>
              <span className="microlabel">Next scheduled check</span>
              <strong>
                {paused
                  ? meta.label
                  : data.scheduler.nextRunAt
                    ? formatRelative(data.scheduler.nextRunAt, referenceNow)
                    : "—"}
              </strong>
              <span className="abs">
                {paused || !data.scheduler.nextRunAt ? "—" : formatDhaka(data.scheduler.nextRunAt)}
              </span>
            </div>
          </div>
          <Button
            variant={paused ? "primary" : "secondary"}
            busy={acting}
            busyLabel={paused ? "Resuming…" : "Pausing…"}
            disabled={acting || data.scheduler.status === "pausing"}
            onClick={() => setConfirming(true)}
          >
            {paused ? "Resume checks" : "Pause checks"}
          </Button>
        </div>
      </section>

      {actionError || error ? (
        <div style={{ marginBottom: 16 }}>
          <Notice>{actionError || error}</Notice>
        </div>
      ) : null}

      <div className="bento">
        <aside className="side-stack" aria-label="Summary">
          <article className="tile">
            <div className="tile-head">
              <p className="microlabel">Today’s new jobs</p>
            </div>
            <span className="tile-value">{data.todayJobs}</span>
            <span className="tile-sub">Unique jobs after baseline · Dhaka day</span>
          </article>
          <article className="tile">
            <div className="tile-head">
              <p className="microlabel">Bot users</p>
              <Link className="link" href="/bot" prefetch={false}>
                Manage
              </Link>
            </div>
            <span className="tile-value">{data.botUsers.total}</span>
            <span className="tile-sub">
              <span className="chip">
                <span className="dot" style={{ color: "var(--ok)" }} aria-hidden="true" /> {data.botUsers.on} on
              </span>
              <span className="chip">
                <span className="dot dot-hollow" style={{ color: "var(--ink-3)" }} aria-hidden="true" />{" "}
                {data.botUsers.off} off
              </span>
              <span className="chip">
                <span className="dot" style={{ color: "var(--warn)" }} aria-hidden="true" />{" "}
                {data.botUsers.pending} pending
              </span>
            </span>
          </article>
          <article className="tile">
            <div className="tile-head">
              <p className="microlabel">Active sources</p>
              <Link className="link" href="/sources" prefetch={false}>
                Manage
              </Link>
            </div>
            <span className="tile-value">
              {data.activeSources} <small>/ {data.totalSources}</small>
            </span>
            <span className="tile-sub">Enabled / total configured sources</span>
          </article>
        </aside>

        <section aria-labelledby="latest-jobs">
          <div className="section-head">
            <h2 id="latest-jobs">
              Latest jobs{" "}
              <span className="count">{data.latestJobs.length ? `· ${data.latestJobs.length}` : ""}</span>
            </h2>
            <Link className="link" href="/jobs" prefetch={false}>
              View full history →
            </Link>
          </div>
          {data.latestJobs.length ? (
            <JobList jobs={data.latestJobs} now={referenceNow} />
          ) : (
            <EmptyState title="No stored jobs" icon={<IconInbox size={18} />}>
              New non-baseline jobs will appear after checks run.
            </EmptyState>
          )}
        </section>
      </div>

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
