"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { EmptyState, ErrorState, JobList, LoadingState, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { jobsSchema, type Job } from "@/lib/contracts";

export default function JobsPage() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [retry, setRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  async function loadMore() {
    const params = new URLSearchParams();
    if (deferredQuery) params.set("q", deferredQuery);
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
    const controller = new AbortController();
    const key = `${deferredQuery}\0${retry}`;
    const params = new URLSearchParams();
    if (deferredQuery) params.set("q", deferredQuery);
    void api(`/api/jobs?${params.toString()}`, { signal: controller.signal })
      .then((value) => jobsSchema.parse(value))
      .then((result) => {
        setJobs(result.jobs);
        setCursor(result.nextCursor);
        setError("");
        setLoadedKey(key);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setJobs([]);
        setCursor(null);
        setError(loadError instanceof Error ? loadError.message : "Jobs request failed");
        setLoadedKey(key);
      });
    return () => controller.abort();
  }, [deferredQuery, retry]);

  const requestKey = `${deferredQuery}\0${retry}`;
  const loading = query.trim() !== deferredQuery || loadedKey !== requestKey;

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
            onChange={(event) => setQuery(event.target.value)}
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
