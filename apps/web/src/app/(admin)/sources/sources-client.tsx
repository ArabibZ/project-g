"use client";

import { sourceUrlSchema, SOURCE_HOST } from "@project-g/shared";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  IconGrip,
  IconMore,
  IconPlus,
  IconSources,
  Notice,
  Pill
} from "@/components/ui";
import { api } from "@/lib/api";
import { sourcesSchema, type Source } from "@/lib/contracts";
import { compactUrl, formatRelative } from "@/lib/format";

type Phase = "idle" | "testing" | "saving";

/* ---------------- inline add (intro panel) ---------------- */

function InlineAdd({
  busyGlobal,
  onAdded,
  beginMutation,
  endMutation
}: {
  busyGlobal: boolean;
  onAdded: () => Promise<void>;
  beginMutation: (key: string) => boolean;
  endMutation: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const busy = phase !== "idle";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const parsed = sourceUrlSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid source URL");
      return;
    }
    if (!beginMutation("add")) return;

    try {
      setPhase("testing");
      await api("/api/sources/test", {
        method: "POST",
        body: JSON.stringify({ url: parsed.data })
      });
      setPhase("saving");
      await api("/api/sources", {
        method: "POST",
        body: JSON.stringify({ url: parsed.data })
      });
      setValue("");
      setSuccess("Source added. New sources start Off.");
      await onAdded();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Source validation failed");
    } finally {
      setPhase("idle");
      endMutation();
    }
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${id}-url`}>Add a GigClickers URL</label>
        <input
          className="input mono"
          id={`${id}-url`}
          type="url"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={`https://${SOURCE_HOST}/…`}
          autoComplete="url"
          spellCheck={false}
          maxLength={2048}
          required
          disabled={busy || busyGlobal}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help`}
        />
        <p className="field-help" id={`${id}-help`}>
          HTTPS on {SOURCE_HOST} only. Live-tested before saving; new sources start Off.
        </p>
      </div>

      {phase === "testing" ? (
        <p className="notice notice-info" role="status">
          <span className="spin" aria-hidden="true" />
          <span>Testing source — fetching live page…</span>
        </p>
      ) : null}
      {success && phase === "idle" ? <Notice tone="success">{success}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}

      <Button
        type="submit"
        variant="primary"
        busy={busy}
        busyLabel={phase === "testing" ? "Validating…" : "Saving…"}
        disabled={busyGlobal}
      >
        <IconPlus size={14} /> Test & add
      </Button>
    </form>
  );
}

/* ---------------- edit dialog ---------------- */

function EditDialog({
  source,
  onClose,
  onSaved,
  busyGlobal,
  beginMutation,
  endMutation
}: {
  source: Source;
  onClose: () => void;
  onSaved: () => Promise<void>;
  busyGlobal: boolean;
  beginMutation: (key: string) => boolean;
  endMutation: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(source.url);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const busy = phase !== "idle";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const parsed = sourceUrlSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid source URL");
      return;
    }
    if (parsed.data === source.normalizedUrl) {
      onClose();
      return;
    }
    if (!beginMutation(`edit:${source.id}`)) return;

    try {
      setPhase("testing");
      await api("/api/sources/test", {
        method: "POST",
        body: JSON.stringify({ url: parsed.data })
      });
      setPhase("saving");
      await api(`/api/sources/${encodeURIComponent(source.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ url: parsed.data })
      });
      await onSaved();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Source validation failed");
    } finally {
      setPhase("idle");
      endMutation();
    }
  }

  return (
    <Dialog open onClose={() => !busy && !busyGlobal && onClose()} labelledBy={`${id}-title`}>
      <form className="dialog-panel" onSubmit={submit}>
        <div className="dialog-head">
          <p className="microlabel">Source URL</p>
          <h2 id={`${id}-title`}>Edit source</h2>
        </div>
        <div className="field">
          <label htmlFor={`${id}-url`}>GigClickers URL</label>
          <input
            className="input mono"
            id={`${id}-url`}
            type="url"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={`https://${SOURCE_HOST}/…`}
            autoComplete="url"
            spellCheck={false}
            maxLength={2048}
            required
            autoFocus
            disabled={busy || busyGlobal}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-help`}
          />
          <p className="field-help" id={`${id}-help`}>
            Must be HTTPS on {SOURCE_HOST}. Changing the URL restarts its baseline.
          </p>
        </div>

        {phase === "testing" ? (
          <p className="notice notice-info" role="status">
            <span className="spin" aria-hidden="true" />
            <span>Testing source — fetching live page…</span>
          </p>
        ) : null}
        {error ? <Notice>{error}</Notice> : null}

        <div className="dialog-actions">
          <Button variant="quiet" disabled={busy || busyGlobal} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            busyLabel={phase === "testing" ? "Validating…" : "Saving…"}
            disabled={busyGlobal}
          >
            Test & save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ---------------- row menu ---------------- */

function RowMenu({
  label,
  onEdit,
  onDelete,
  disabled
}: {
  label: string;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || !ref.current?.open) return;
      ref.current.open = false;
      ref.current.querySelector<HTMLElement>("summary")?.focus();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (disabled && ref.current) ref.current.open = false;
  }, [disabled]);

  return (
    <details className="menu" ref={ref}>
      <summary
        className="icon-btn"
        aria-label={label}
        aria-disabled={disabled || undefined}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (disabled && (event.key === "Enter" || event.key === " ")) event.preventDefault();
        }}
      >
        <IconMore size={16} />
      </summary>
      <div className="menu-list" aria-label={label}>
        <button
          type="button"
          onClick={() => {
            if (ref.current) ref.current.open = false;
            onEdit();
          }}
        >
          Edit URL
        </button>
        <button
          type="button"
          className="danger-text"
          onClick={() => {
            if (ref.current) ref.current.open = false;
            onDelete();
          }}
        >
          Delete…
        </button>
      </div>
    </details>
  );
}

/* ---------------- page ---------------- */

function reorder(items: Source[], sourceId: string, targetId: string): Source[] {
  const from = items.findIndex((item) => item.id === sourceId);
  const to = items.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (!moved) return items;
  next.splice(to, 0, moved);
  return next;
}

export function SourcesClient({
  initialSources,
  initialNow
}: {
  initialSources: Source[];
  initialNow: number;
}) {
  const [sources, setSources] = useState(initialSources);
  const [referenceNow, setReferenceNow] = useState(initialNow);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Source | null>(null);
  const [deleting, setDeleting] = useState<Source>();
  const [busy, setBusy] = useState("");
  const [dragging, setDragging] = useState<string>();
  const [reorderNote, setReorderNote] = useState("");
  const sourcesRef = useRef(initialSources);
  const busyRef = useRef(false);
  const dragId = useRef<string | null>(null);
  const dragOriginal = useRef<Source[] | null>(null);
  const dragOverId = useRef<string | null>(null);

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  function beginMutation(key: string): boolean {
    if (busyRef.current || dragId.current) return false;
    busyRef.current = true;
    setBusy(key);
    return true;
  }

  function endMutation() {
    busyRef.current = false;
    setBusy("");
  }

  async function load() {
    try {
      const result = sourcesSchema.parse(await api("/api/sources"));
      const ordered = [...result.sources].sort((a, b) => a.position - b.position);
      setError("");
      setSources(ordered);
      sourcesRef.current = ordered;
      setReferenceNow(Date.now());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Sources request failed");
    }
  }

  async function toggle(source: Source) {
    if (!beginMutation(source.id)) return;
    const previous = sources;
    const enabled = !source.enabled;
    setError("");
    setSources((items) => items.map((item) => (item.id === source.id ? { ...item, enabled } : item)));
    try {
      await api(`/api/sources/${encodeURIComponent(source.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled })
      });
    } catch (mutationError) {
      setSources(previous);
      setError(mutationError instanceof Error ? mutationError.message : "Source update failed");
    } finally {
      endMutation();
    }
  }

  async function removeSource() {
    if (!deleting) return;
    if (!beginMutation("delete")) return;
    setError("");
    try {
      await api(`/api/sources/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
      setSources((items) => items.filter((item) => item.id !== deleting.id));
      setDeleting(undefined);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Source deletion failed");
    } finally {
      endMutation();
    }
  }

  async function persistOrder(next: Source[], previous: Source[]) {
    if (next.map((item) => item.id).join() === previous.map((item) => item.id).join()) return;
    if (!beginMutation("order")) {
      setSources(previous);
      sourcesRef.current = previous;
      return;
    }
    setError("");
    try {
      await api("/api/sources/order", {
        method: "PUT",
        body: JSON.stringify({ ids: next.map((item) => item.id) })
      });
    } catch (mutationError) {
      setSources(previous);
      sourcesRef.current = previous;
      const detail = mutationError instanceof Error ? mutationError.message : "Order update failed";
      setError(`${detail} Previous order restored.`);
    } finally {
      endMutation();
    }
  }

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>, sourceId: string) {
    if (busyRef.current || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragId.current = sourceId;
    dragOriginal.current = sourcesRef.current;
    dragOverId.current = null;
    setDragging(sourceId);
  }

  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const sourceId = dragId.current;
    if (!sourceId) return;
    const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const targetId = element?.closest<HTMLElement>("[data-source-id]")?.dataset.sourceId;
    if (!targetId || targetId === sourceId) {
      dragOverId.current = null;
      return;
    }
    if (dragOverId.current === targetId) return;
    dragOverId.current = targetId;
    const next = reorder(sourcesRef.current, sourceId, targetId);
    sourcesRef.current = next;
    setSources(next);
  }

  function pointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragId.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const previous = dragOriginal.current;
    dragId.current = null;
    dragOriginal.current = null;
    dragOverId.current = null;
    setDragging(undefined);
    if (previous) void persistOrder(sourcesRef.current, previous);
  }

  function pointerCancel() {
    if (dragOriginal.current) {
      setSources(dragOriginal.current);
      sourcesRef.current = dragOriginal.current;
    }
    dragId.current = null;
    dragOriginal.current = null;
    dragOverId.current = null;
    setDragging(undefined);
  }

  function keyboardMove(sourceId: string, direction: -1 | 1) {
    if (busyRef.current || dragId.current) return;
    const previous = sourcesRef.current;
    const index = previous.findIndex((item) => item.id === sourceId);
    const target = previous[index + direction];
    if (index < 0 || !target) return;
    const next = reorder(previous, sourceId, target.id);
    setSources(next);
    sourcesRef.current = next;
    setReorderNote(`Source moved to position ${index + 1 + direction} of ${next.length}.`);
    void persistOrder(next, previous);
  }

  if (!sources.length && error) {
    return <ErrorState message={error} retry={() => void load()} />;
  }

  const activeCount = sources.filter((source) => source.enabled).length;

  return (
    <div className="split">
      <section className="split-intro" aria-labelledby="sources-title">
        <div className="intro-panel">
          <div>
            <p className="microlabel" style={{ marginBottom: 9 }}>
              Scrape inputs
            </p>
            <h1 id="sources-title">Sources</h1>
            <p className="lede" style={{ marginTop: 7 }}>
              Checked top to bottom. Drag the handle or press the arrow keys on it to reorder.
            </p>
          </div>
          <div className="intro-stat">
            <strong>{sources.length}</strong> configured
            <span aria-hidden="true">·</span>
            <strong>{activeCount}</strong> on
          </div>
          <InlineAdd
            busyGlobal={Boolean(busy) || Boolean(dragging)}
            onAdded={load}
            beginMutation={beginMutation}
            endMutation={endMutation}
          />
        </div>
      </section>

      <section aria-label="Sources in check order">
        {error && !deleting ? (
          <div style={{ marginBottom: 14 }}>
            <Notice>{error}</Notice>
          </div>
        ) : null}
        <p className="sr-only" role="status" aria-live="polite">
          {reorderNote}
        </p>

        {sources.length ? (
          <div className="dlist source-list">
            <ol aria-label="Sources in check order">
              {sources.map((source, index) => (
                <li key={source.id} style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
                  <article
                    className="source-row"
                    data-source-id={source.id}
                    data-dragging={dragging === source.id || undefined}
                  >
                    <button
                      className="drag-handle"
                      type="button"
                      aria-label={`Reorder source ${index + 1} of ${sources.length}: ${compactUrl(source.url)}. Press arrow up or arrow down to move, or drag.`}
                      aria-pressed={dragging === source.id}
                      disabled={Boolean(busy)}
                      onPointerDown={(event) => pointerDown(event, source.id)}
                      onPointerMove={pointerMove}
                      onPointerUp={pointerUp}
                      onPointerCancel={pointerCancel}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                          event.preventDefault();
                          keyboardMove(source.id, event.key === "ArrowUp" ? -1 : 1);
                        }
                      }}
                    >
                      <IconGrip size={17} />
                    </button>
                    <div className="source-main">
                      <a
                        className="source-url"
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        title={source.url}
                      >
                        {compactUrl(source.url)}
                      </a>
                      <div className="source-meta">
                        <span className="pos num" aria-hidden="true">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span>
                          {source.lastCheckedAt
                            ? `Checked ${formatRelative(source.lastCheckedAt, referenceNow)}`
                            : "Never checked"}
                        </span>
                        {source.lastFailedAt && source.failureCount > 0 ? (
                          <span className="fail" title={source.lastError ?? undefined}>
                            ⚠ {source.failureCount} consecutive failure
                            {source.failureCount === 1 ? "" : "s"} · last{" "}
                            {formatRelative(source.lastFailedAt, referenceNow)}
                          </span>
                        ) : source.lastFailedAt ? (
                          <span>Recovered · failed {formatRelative(source.lastFailedAt, referenceNow)}</span>
                        ) : (
                          <span>No failures</span>
                        )}
                      </div>
                    </div>
                    <div className="source-side">
                      <div className="source-flags">
                        {!source.baselineCompleted ? (
                          <Pill tone="accent" hollow>
                            Baseline pending
                          </Pill>
                        ) : null}
                        <Pill tone={source.enabled ? "ok" : "neutral"} hollow={!source.enabled}>
                          {source.enabled ? "On" : "Off"}
                        </Pill>
                      </div>
                      <label className="switch-hit">
                        <span className="sr-only">
                          {source.enabled ? `Turn source ${index + 1} off` : `Turn source ${index + 1} on`}
                        </span>
                        <input
                          type="checkbox"
                          role="switch"
                          className="switch"
                          checked={source.enabled}
                          disabled={Boolean(busy) || Boolean(dragging)}
                          onChange={() => void toggle(source)}
                        />
                      </label>
                      <RowMenu
                        label={`Actions for source ${index + 1}`}
                        disabled={Boolean(busy) || Boolean(dragging)}
                        onEdit={() => setEditing(source)}
                        onDelete={() => {
                          setError("");
                          setDeleting(source);
                        }}
                      />
                    </div>
                  </article>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <EmptyState title="No sources" icon={<IconSources size={18} />}>
            Add a valid GigClickers URL. New sources start Off.
          </EmptyState>
        )}
      </section>

      {editing ? (
        <EditDialog
          key={editing.id}
          source={editing}
          onClose={() => setEditing(null)}
          busyGlobal={Boolean(busy)}
          beginMutation={beginMutation}
          endMutation={endMutation}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleting)}
        busy={busy === "delete"}
        destructive
        title="Delete source?"
        confirmLabel="Delete source"
        onClose={() => {
          setDeleting(undefined);
          setError("");
        }}
        onConfirm={() => void removeSource()}
      >
        <p className="truncate mono" style={{ fontSize: 12 }} title={deleting?.url}>
          {deleting ? compactUrl(deleting.url) : ""}
        </p>
        <p>Source is removed from future checks. Existing jobs and full history are kept.</p>
        {error ? <Notice>{error}</Notice> : null}
      </ConfirmDialog>
    </div>
  );
}
