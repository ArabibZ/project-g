"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { Job } from "@/lib/contracts";
import { compactUrl, formatDhaka } from "@/lib/format";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state-block" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="state-block state-error" role="alert">
      <strong>Could not load</strong>
      <span>{message}</span>
      {retry ? (
        <button className="button button-secondary" type="button" onClick={retry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="state-block state-empty">
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}

export function Notice({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "success" }) {
  return (
    <p className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "warn" | "bad" | "neutral" }) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

type ConfirmDialogProps = {
  busy?: boolean;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
};

export function ConfirmDialog({
  busy = false,
  children,
  confirmLabel,
  destructive = false,
  onClose,
  onConfirm,
  open,
  title
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      className="dialog"
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="dialog-panel">
        <div>
          <p className="eyebrow">Confirm action</p>
          <h2>{title}</h2>
        </div>
        <div className="dialog-copy">{children}</div>
        <div className="dialog-actions">
          <button className="button button-quiet" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className={`button ${destructive ? "button-danger" : "button-primary"}`}
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function JobList({ jobs }: { jobs: Job[] }) {
  return (
    <div className="job-list" role="list">
      <div className="job-row job-head" aria-hidden="true">
        <span>Job</span>
        <span>Progress</span>
        <span>Payment</span>
        <span>Source</span>
        <span>First seen</span>
      </div>
      {jobs.map((job) => {
        const percentage = Math.min(100, Math.round((job.doneCount / job.totalTarget) * 100));
        return (
          <article className="job-row" role="listitem" key={job.jobId}>
            <div className="job-main">
              <span className="mobile-label">Job</span>
              <a href={job.detailsUrl} target="_blank" rel="noreferrer" className="job-name">
                {job.name}
              </a>
              <span className="mono muted">#{job.jobId}</span>
            </div>
            <div className="job-progress">
              <span className="mobile-label">Progress</span>
              <span className="mono">
                {job.doneCount} / {job.totalTarget}
              </span>
              <progress value={percentage} max="100" aria-label={`${percentage}% complete`} />
            </div>
            <div>
              <span className="mobile-label">Payment</span>
              <strong className="payment">{job.payment}</strong>
            </div>
            <div className="truncate">
              <span className="mobile-label">Source</span>
              <span title={job.sourceUrl}>{compactUrl(job.sourceUrl)}</span>
            </div>
            <div>
              <span className="mobile-label">First seen</span>
              <time dateTime={job.firstSeenAt}>{formatDhaka(job.firstSeenAt)}</time>
            </div>
          </article>
        );
      })}
    </div>
  );
}
