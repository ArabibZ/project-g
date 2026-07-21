"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { EmptyState, ErrorState, JobList, LoadingState, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { jobsSchema, type Job } from "@/lib/contracts";

type LoadedRequest = { query: string; retry: number };

export function JobsClient({ initialJobs, initialCursor }: { initialJobs: Job[]; initialCursor: string | null }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [jobs, setJobs] = useState(initialJobs);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadedRequest, setLoadedRequest] = useState<LoadedRequest>({ query: "", retry: 0 });
  const [retry, setRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
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
      <div className="page-heading jobs-heading">
        <div>
          <p className="eyebrow">Stored history</p>
          <h1>Jobs</h1>
          <p>Newest first. First-seen timestamps use Dhaka time.</p>
        </div>
        <div className="job-search field">
          <label htmlFor="job-search">Search job ID or name</label>
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
            placeholder="ID or job name"
            maxLength={120}
          />
        </div>
      </div>

      {error && jobs.length ? <Notice>{error}</Notice> : null}
      {loading && !jobs.length ? (
        <LoadingState label={deferredQuery ? "Searching jobs" : "Loading job history"} />
      ) : error && !jobs.length ? (
        <ErrorState message={error} retry={() => setRetry((value) => value + 1)} />
      ) : jobs.length ? (
        <>
          <JobList jobs={jobs} />
          <div className="load-more">
            {cursor ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            ) : (
              <span className="muted">End of history</span>
            )}
          </div>
        </>
      ) : (
        <EmptyState title={deferredQuery ? "No matching jobs" : "No job history"}>
          {deferredQuery ? "Try another ID or name." : "Stored non-baseline jobs appear here."}
        </EmptyState>
      )}
    </>
  );
}
