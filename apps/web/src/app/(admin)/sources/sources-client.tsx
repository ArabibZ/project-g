"use client";

import { sourceUrlSchema } from "@project-g/shared";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { ConfirmDialog, EmptyState, ErrorState, Notice, StatusPill } from "@/components/ui";
import { api } from "@/lib/api";
import { sourcesSchema, type Source } from "@/lib/contracts";
import { compactUrl, formatRelative } from "@/lib/format";

type Editor = { source?: Source };

function SourceEditor({
  editor,
  busy,
  error,
  onClose,
  onSubmit
}: {
  editor: Editor;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(editor.source?.url ?? "");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(value);
  }

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
      <form className="dialog-panel" onSubmit={submit}>
        <div>
          <p className="eyebrow">Source URL</p>
          <h2>{editor.source ? "Edit source" : "Add source"}</h2>
        </div>
        <div className="field">
          <label htmlFor="source-url">GigClickers URL</label>
          <input
            className="input"
            id="source-url"
            type="url"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://bot.gigclickers.com/..."
            autoComplete="url"
            maxLength={2048}
            required
            autoFocus
          />
          <p className="field-help">API validates source structure. New sources stay Off.</p>
        </div>
        {error ? <Notice>{error}</Notice> : null}
        <div className="dialog-actions">
          <button className="button button-quiet" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Validating..." : editor.source ? "Save source" : "Add source"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

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
  const [editorError, setEditorError] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<Source>();
  const [busy, setBusy] = useState("");
  const [dragging, setDragging] = useState<string>();
  const sourcesRef = useRef(initialSources);
  const dragId = useRef<string | null>(null);
  const dragOriginal = useRef<Source[] | null>(null);
  const dragOverId = useRef<string | null>(null);

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

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

  async function saveSource(rawUrl: string) {
    const parsed = sourceUrlSchema.safeParse(rawUrl);
    if (!parsed.success) {
      setEditorError(parsed.error.issues[0]?.message ?? "Invalid source URL");
      return;
    }
    const current = editor?.source;
    if (current && parsed.data === current.normalizedUrl) {
      setEditor(null);
      return;
    }

    setBusy("editor");
    setEditorError("");
    try {
      await api("/api/sources/test", {
        method: "POST",
        body: JSON.stringify({ url: parsed.data })
      });
      if (current) {
        await api(`/api/sources/${encodeURIComponent(current.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ url: parsed.data })
        });
      } else {
        await api("/api/sources", {
          method: "POST",
          body: JSON.stringify({ url: parsed.data })
        });
      }
      setEditor(null);
      await load();
    } catch (mutationError) {
      setEditorError(mutationError instanceof Error ? mutationError.message : "Source validation failed");
    } finally {
      setBusy("");
    }
  }

  async function toggle(source: Source) {
    const previous = sources;
    const enabled = !source.enabled;
    setBusy(source.id);
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
      setBusy("");
    }
  }

  async function removeSource() {
    if (!deleting) return;
    setBusy("delete");
    setError("");
    try {
      await api(`/api/sources/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
      setSources((items) => items.filter((item) => item.id !== deleting.id));
      setDeleting(undefined);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Source deletion failed");
    } finally {
      setBusy("");
    }
  }

  async function persistOrder(next: Source[], previous: Source[]) {
    if (next.map((item) => item.id).join() === previous.map((item) => item.id).join()) return;
    setBusy("order");
    setError("");
    try {
      await api("/api/sources/order", {
        method: "PUT",
        body: JSON.stringify({ ids: next.map((item) => item.id) })
      });
    } catch (mutationError) {
      setSources(previous);
      sourcesRef.current = previous;
      setError(mutationError instanceof Error ? mutationError.message : "Order was not saved; previous order restored.");
    } finally {
      setBusy("");
    }
  }

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>, sourceId: string) {
    if (busy || event.button !== 0) return;
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
    if (busy) return;
    const previous = sourcesRef.current;
    const index = previous.findIndex((item) => item.id === sourceId);
    const target = previous[index + direction];
    if (index < 0 || !target) return;
    const next = reorder(previous, sourceId, target.id);
    setSources(next);
    sourcesRef.current = next;
    void persistOrder(next, previous);
  }

  if (!sources.length && error) return <ErrorState message={error} retry={() => void load()} />;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Scrape inputs</p>
          <h1>Sources</h1>
          <p>{sources.length} configured. Drag handles or arrow keys change check order.</p>
        </div>
        <button
          className="button button-primary"
          type="button"
          onClick={() => {
            setEditorError("");
            setEditor({});
          }}
        >
          Add source
        </button>
      </div>

      {error ? <Notice>{error}</Notice> : null}

      {sources.length ? (
        <div className="source-list" role="list" aria-label="Sources in check order">
          {sources.map((source, index) => (
            <article
              className={`source-row${dragging === source.id ? " source-dragging" : ""}`}
              role="listitem"
              data-source-id={source.id}
              key={source.id}
            >
              <button
                className="drag-handle"
                type="button"
                aria-label={`Move source ${index + 1}. Use arrow keys or drag.`}
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
                <span aria-hidden="true">=</span>
              </button>
              <span className="source-number mono">{String(index + 1).padStart(2, "0")}</span>
              <div className="source-main">
                <a href={source.url} target="_blank" rel="noreferrer" title={source.url}>
                  {compactUrl(source.url)}
                </a>
                <div className="source-meta">
                  <span>Checked {formatRelative(source.lastCheckedAt, referenceNow)}</span>
                  {source.lastFailedAt ? (
                    <span className="failure-copy" title={source.lastError ?? undefined}>
                      Failed {formatRelative(source.lastFailedAt, referenceNow)} ({source.failureCount})
                    </span>
                  ) : (
                    <span>No failures</span>
                  )}
                </div>
              </div>
              <StatusPill tone={source.enabled ? "good" : "neutral"}>{source.enabled ? "On" : "Off"}</StatusPill>
              <label className="source-switch">
                <span className="sr-only">{source.enabled ? "Turn source off" : "Turn source on"}</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={source.enabled}
                  disabled={Boolean(busy)}
                  onChange={() => void toggle(source)}
                />
              </label>
              <details className="source-menu">
                <summary aria-label={`Actions for source ${index + 1}`}>More</summary>
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditorError("");
                      setEditor({ source });
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className="danger-text" onClick={() => setDeleting(source)}>
                    Delete
                  </button>
                </div>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="No sources">Add a valid GigClickers URL. New source starts Off.</EmptyState>
      )}

      {editor ? (
        <SourceEditor
          key={editor.source?.id ?? "new"}
          editor={editor}
          busy={busy === "editor"}
          error={editorError}
          onClose={() => setEditor(null)}
          onSubmit={(value) => void saveSource(value)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleting)}
        busy={busy === "delete"}
        destructive
        title="Delete source?"
        confirmLabel="Delete source"
        onClose={() => setDeleting(undefined)}
        onConfirm={() => void removeSource()}
      >
        <p>Source is removed from future checks. Existing jobs and full history are kept.</p>
      </ConfirmDialog>
    </>
  );
}
