"use client";

import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode
} from "react";
import type { Job } from "@/lib/contracts";
import { compactUrl, formatDhakaShort, formatRelative } from "@/lib/format";

/* ---------------- icons (inline, 1.7px stroke) ---------------- */

type IconProps = { size?: number; className?: string };

function icon(path: ReactNode) {
  return function Icon({ size = 16, className }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className}
      >
        {path}
      </svg>
    );
  };
}

export const IconGauge = icon(
  <>
    <path d="M12 3a9 9 0 1 0 9 9" />
    <path d="M12 12 17 7" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </>
);
export const IconSources = icon(
  <>
    <path d="M4 6h16M4 12h16M4 18h10" />
    <circle cx="19" cy="18" r="2" />
  </>
);
export const IconBot = icon(
  <>
    <path d="m21.7 3.3-3.1 15a1 1 0 0 1-1.5.66l-4.6-3.1-2.2 2.4a.9.9 0 0 1-1.55-.5l-.75-4.3-4.5-1.6a.95.95 0 0 1 .05-1.8l16.9-6a.95.95 0 0 1 1.25 1.24Z" />
    <path d="M8 13.5 17.5 6" />
  </>
);
export const IconJobs = icon(
  <>
    <path d="M4 7h16v13H4z" />
    <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 12h16" />
  </>
);
export const IconActivity = icon(
  <>
    <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
    <path d="m3 6 5-3 6 5 7-5" />
  </>
);
export const IconLogout = icon(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </>
);
export const IconPlus = icon(<path d="M12 5v14M5 12h14" />);
export const IconGrip = icon(
  <>
    <circle cx="9" cy="6" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.15" fill="currentColor" stroke="none" />
  </>
);
export const IconMore = icon(
  <>
    <circle cx="12" cy="5" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none" />
  </>
);
export const IconCheck = icon(<path d="m4.5 12.5 5 5 10-11" />);
export const IconAlert = icon(
  <>
    <path d="M12 3.5 2.7 19.6a1 1 0 0 0 .87 1.5h16.86a1 1 0 0 0 .87-1.5L12 3.5Z" />
    <path d="M12 9.5v4.5" />
    <circle cx="12" cy="17.3" r="1" fill="currentColor" stroke="none" />
  </>
);
export const IconInfo = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <circle cx="12" cy="7.6" r="1" fill="currentColor" stroke="none" />
  </>
);
export const IconLock = icon(
  <>
    <rect x="5" y="10.5" width="14" height="9.5" rx="1.8" />
    <path d="M8 10.5V8a4 4 0 1 1 8 0v2.5" />
    <circle cx="12" cy="15.3" r="1.2" fill="currentColor" stroke="none" />
  </>
);
export const IconSearch = icon(
  <>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m20.5 20.5-5.2-5.2" />
  </>
);
export const IconInbox = icon(
  <>
    <path d="M4 5h16v14H4z" />
    <path d="M4 13h4.5l1.5 2.5h4L15.5 13H20" />
  </>
);

/* ---------------- button ---------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger" | "danger-quiet";
  busy?: boolean;
  busyLabel?: string;
};

export function Button({
  variant = "secondary",
  busy = false,
  busyLabel,
  children,
  className = "",
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className="spin" aria-hidden="true" /> : null}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

/* ---------------- notice ---------------- */

export function Notice({
  tone = "error",
  children
}: {
  tone?: "error" | "success" | "info";
  children: ReactNode;
}) {
  const Icon = tone === "error" ? IconAlert : tone === "success" ? IconCheck : IconInfo;
  return (
    <p className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={14} />
      <span>{children}</span>
    </p>
  );
}

/* ---------------- pills ---------------- */

export function Pill({
  tone = "neutral",
  dot = true,
  pulse = false,
  hollow = false,
  children
}: {
  tone?: "neutral" | "ok" | "warn" | "bad" | "accent";
  dot?: boolean;
  pulse?: boolean;
  hollow?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`pill${tone === "neutral" ? "" : ` pill-${tone}`}`}>
      {dot ? (
        <span
          className={`dot${pulse ? " dot-pulse" : ""}${hollow ? " dot-hollow" : ""}`}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  );
}

/* ---------------- state blocks ---------------- */

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state-block" role="status">
      <span className="spin spin-lg" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="state-block error" role="alert">
      <span className="state-icon">
        <IconAlert size={18} />
      </span>
      <strong>Could not load</strong>
      <span>{message}</span>
      {retry ? (
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  icon,
  action,
  children
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="state-block empty">
      {icon ? <span className="state-icon">{icon}</span> : null}
      <strong>{title}</strong>
      <span>{children}</span>
      {action}
    </div>
  );
}

/* ---------------- skeleton ---------------- */

export function SkeletonRows({ rows = 4, height = 58 }: { rows?: number; height?: number }) {
  return (
    <div className="card" role="status" aria-label="Loading">
      <span className="sr-only">Loading…</span>
      <div style={{ display: "grid", gap: 1 }}>
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            style={{ padding: "14px 18px", borderTop: index ? "1px solid var(--line)" : 0 }}
          >
            <div className="skel" style={{ height: 12, width: `${58 - (index % 3) * 9}%`, marginBottom: 8 }} />
            <div className="skel" style={{ height: 9, width: `${30 + (index % 4) * 8}%` }} />
            <div style={{ height: Math.max(0, height - 56) }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- dialog ---------------- */

export function Dialog({
  open,
  onClose,
  labelledBy,
  className = "",
  children
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  busy = false,
  destructive = false,
  onClose,
  onConfirm,
  children
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  busy?: boolean;
  destructive?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} labelledBy={`${id}-title`}>
      <div className="dialog-panel">
        <div className="dialog-head">
          <p className="microlabel">Confirm action</p>
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
        <div className="dialog-copy">{children}</div>
        <div className="dialog-actions">
          <Button variant="quiet" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            busy={busy}
            busyLabel="Working…"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------- meter ---------------- */

export function Meter({ done, target }: { done: number; target: number }) {
  const pct = Math.min(100, Math.round((done / Math.max(1, target)) * 100));
  return (
    <progress
      className={`meter${pct >= 100 ? " full" : ""}`}
      max={Math.max(1, target)}
      value={Math.min(done, Math.max(1, target))}
      aria-label={`${pct}% complete`}
    />
  );
}

/* ---------------- job ledger (dashboard + jobs) ---------------- */

export function JobList({ jobs, now }: { jobs: Job[]; now: number }) {
  return (
    <div className="dlist">
      <ul>
        {jobs.map((job, index) => (
          <li key={job.jobId} style={{ "--i": Math.min(index, 12) } as CSSProperties}>
            <article className="lrow">
              <a
                className="name"
                href={job.detailsUrl}
                target="_blank"
                rel="noreferrer"
                title={job.name}
              >
                {job.name}
              </a>
              <span className="pay">
                <span className="sr-only">Payment: </span>
                {job.payment}
              </span>
              <div className="meta">
                <span className="job-id">
                  <span className="sr-only">Job ID: </span>#{job.jobId}
                </span>
                <span className="m-progress">
                  <Meter done={job.doneCount} target={job.totalTarget} />
                  <span className="num">
                    <span className="sr-only">Progress: </span>
                    {job.doneCount}
                    <span className="faint"> / {job.totalTarget}</span>
                  </span>
                </span>
                <span className="m-src" title={job.sourceUrl}>
                  <span className="sr-only">Source: </span>
                  {compactUrl(job.sourceUrl)}
                </span>
              </div>
              <time
                className="time"
                dateTime={job.firstSeenAt}
                title={`First seen (Dhaka): ${formatDhakaShort(job.firstSeenAt)}`}
              >
                <span className="sr-only">First seen: </span>
                {formatDhakaShort(job.firstSeenAt)} · {formatRelative(job.firstSeenAt, now)}
              </time>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
