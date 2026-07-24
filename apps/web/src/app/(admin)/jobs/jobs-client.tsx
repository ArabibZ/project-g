"use client";

import { useDeferredValue, useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  ErrorState,
  IconInbox,
  IconSearch,
  JobList,
  LoadingState,
  Notice
} from "@/components/ui";
import { api } from "@/lib/api";
import { jobsSchema, type Job } from "@/lib/contracts";

type LoadedRequest = { query: string; retry: number };

export function JobsClient({
  initialJobs,
  initialCursor,
  initialNow
}: {
  initialJobs: Job[];
  initialCursor: string | null;
  initialNow: number;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [jobs, setJobs] = useState(initialJobs);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadedRequest, setLoadedRequest] = useState<LoadedRequest>({ query: "", retry: 0 });
  const [retry, setRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(initialNow);
  const normalizedQuery = query.trim();

  async function loadMore() {
    const params = new URLSearchParams();
    if (loadedRequest.query) params.set("q", loadedRequest.query);
    if (cursor) params.set("cursor", cursor);
    setLoadingMore(true);
    setError("");
    try {
      const result = jobsSchema.parse(await api(`/api/jobs?${params.toString()}`));
      setJobs((items) => [...items, ...result.jobs]);
      setCursor(result.nextCursor);
      setNow(Date.now());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Jobs request failed");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (normalizedQuery !== deferredQuery) return;
    if (loadedRequest.query === deferredQuery && loadedRequest.retry === retry) return;
    if (!deferredQuery) return;

    const request = { query: deferredQuery, retry };
    const controller = new AbortController();
    const params = new URLSearchParams();
    params.set("q", deferredQuery);
    void api(`/api/jobs?${params.toString()}`, { signal: controller.signal })
      .then((value) => jobsSchema.parse(value))
      .then((result) => {
        if (controller.signal.aborted) return;
        setJobs(result.jobs);
        setCursor(result.nextCursor);
        setError("");
        setLoadedRequest(request);
        setNow(Date.now());
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted || (loadError instanceof DOMException && loadError.name === "AbortError")) {
          return;
        }
        setJobs([]);
        setCursor(null);
        setError(loadError instanceof Error ? loadError.message : "Jobs request failed");
        setLoadedRequest(request);
      });
    return () => controller.abort();
  }, [deferredQuery, loadedRequest, normalizedQuery, retry]);

  const loading =
    normalizedQuery !== deferredQuery || loadedRequest.query !== deferredQuery || loadedRequest.retry !== retry;

  return (
    <>
      <div className="jobs-top">
        <div>
          <p className="microlabel" style={{ marginBottom: 8 }}>
            Stored history
          </p>
          <h1>Jobs</h1>
        </div>
        <span className="meta">Newest first · deduplicated · first seen in Dhaka time</span>
      </div>

      <div className="jobs-search">
        <div className="search-bar">
          <IconSearch size={16} />
          <input
            className="input"
            id="job-search"
            type="search"
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              if (!value.trim()) {
                setJobs(initialJobs);
                setCursor(initialCursor);
                setError("");
                setLoadedRequest({ query: "", retry });
              }
            }}
            placeholder="Search job ID or name…"
            aria-label="Search job ID or name"
            maxLength={120}
          />
          <span className="kbd-hint" aria-hidden="true">
            ID · Name
          </span>
        </div>
      </div>

      {error && jobs.length ? (
        <div style={{ marginBottom: 14 }}>
          <Notice>{error}</Notice>
        </div>
      ) : null}

      {loading && !jobs.length ? (
        <LoadingState label={deferredQuery ? "Searching jobs" : "Loading job history"} />
      ) : error && !jobs.length ? (
        <ErrorState message={error} retry={() => setRetry((value) => value + 1)} />
      ) : jobs.length ? (
        <>
          <JobList jobs={jobs} now={now} />
          <div className="list-foot">
            {cursor ? (
              <Button variant="secondary" busy={loadingMore} busyLabel="Loading…" onClick={() => void loadMore()}>
                Load more
              </Button>
            ) : (
              <span className="end-mark">End of history</span>
            )}
          </div>
        </>
      ) : (
        <EmptyState
          title={deferredQuery ? "No matching jobs" : "No job history"}
          icon={deferredQuery ? <IconSearch size={18} /> : <IconInbox size={18} />}
        >
          {deferredQuery ? "Try another ID or name." : "Stored non-baseline jobs appear here."}
        </EmptyState>
      )}
    </>
  );
}
