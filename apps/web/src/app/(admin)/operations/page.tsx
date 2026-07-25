import { operationsSchema, type Operations } from "@/lib/contracts";
import { formatDhaka } from "@/lib/format";
import { requestAdminData } from "@/lib/server/require-admin";

const runLabels: Record<Operations["runs"][number]["status"], string> = {
  running: "Running",
  succeeded: "Succeeded",
  partial: "Partial",
  failed: "Failed"
};

const deliveryLabels: Record<Operations["deliveries"][number]["status"], string> = {
  pending: "Pending",
  sending: "Sending",
  sent: "Sent",
  skipped: "Skipped",
  failed: "Failed"
};

function statusTone(status: string): string {
  if (status === "succeeded" || status === "sent") return "ok";
  if (status === "failed") return "bad";
  if (status === "partial" || status === "pending") return "warn";
  return "neutral";
}

function EmptyLog({ children }: { children: string }) {
  return <p className="ops-empty">{children}</p>;
}

export default async function OperationsPage() {
  const reply = await requestAdminData("operations", "/operations");
  const data = operationsSchema.parse(reply.data);

  return (
    <>
      <header className="ops-head">
        <p className="microlabel">Recent activity · Read only</p>
        <h1>Operations</h1>
        <p>Sanitized scraper, delivery, admin, and login events. Sensitive identities are never shown.</p>
      </header>

      <div className="ops-grid">
        <section className="ops-panel" aria-labelledby="operations-runs">
          <div className="section-head">
            <h2 id="operations-runs">Scrape runs</h2>
            <span className="count">{data.runs.length}</span>
          </div>
          {data.runs.length ? (
            <ol className="ops-list">
              {data.runs.map((run, index) => (
                <li className="ops-row" key={`${run.startedAt}-${index}`}>
                  <div className="ops-row-head">
                    <strong>{runLabels[run.status]}</strong>
                    <span className={`ops-status ops-${statusTone(run.status)}`}>{runLabels[run.status]}</span>
                  </div>
                  <p className="ops-counts">
                    {run.sourcesCompleted}/{run.sourcesTotal} sources · {run.validJobsSeen} valid · {run.newJobsSaved} new
                  </p>
                  <p className="ops-meta">
                    <time dateTime={run.startedAt}>{formatDhaka(run.startedAt)}</time>
                    {run.forcedNotificationsOff ? " · Alerts suppressed" : ""}
                  </p>
                </li>
              ))}
            </ol>
          ) : <EmptyLog>No scrape runs recorded.</EmptyLog>}
        </section>

        <section className="ops-panel" aria-labelledby="operations-deliveries">
          <div className="section-head">
            <h2 id="operations-deliveries">Delivery activity</h2>
            <span className="count">{data.deliveries.length}</span>
          </div>
          {data.deliveries.length ? (
            <ol className="ops-list">
              {data.deliveries.map((delivery, index) => (
                <li className="ops-row" key={`${delivery.createdAt}-${delivery.jobId}-${index}`}>
                  <div className="ops-row-head">
                    <strong className="ops-id">Job #{delivery.jobId}</strong>
                    <span className={`ops-status ops-${statusTone(delivery.status)}`}>
                      {deliveryLabels[delivery.status]}
                    </span>
                  </div>
                  <p className="ops-counts">Attempt {delivery.attempts} of 3</p>
                  {delivery.lastError ? <p className="ops-error">{delivery.lastError}</p> : null}
                  <p className="ops-meta"><time dateTime={delivery.createdAt}>{formatDhaka(delivery.createdAt)}</time></p>
                </li>
              ))}
            </ol>
          ) : <EmptyLog>No delivery activity recorded.</EmptyLog>}
        </section>

        <section className="ops-panel" aria-labelledby="operations-admin">
          <div className="section-head">
            <h2 id="operations-admin">Admin activity</h2>
            <span className="count">{data.audits.length}</span>
          </div>
          {data.audits.length ? (
            <ol className="ops-list">
              {data.audits.map((event, index) => (
                <li className="ops-row" key={`${event.createdAt}-${event.action}-${index}`}>
                  <div className="ops-row-head">
                    <strong>{event.action}</strong>
                    <span className="ops-status ops-neutral">{event.entityType}</span>
                  </div>
                  <p className="ops-meta"><time dateTime={event.createdAt}>{formatDhaka(event.createdAt)}</time></p>
                </li>
              ))}
            </ol>
          ) : <EmptyLog>No admin activity recorded.</EmptyLog>}
        </section>

        <section className="ops-panel" aria-labelledby="operations-login">
          <div className="section-head">
            <h2 id="operations-login">Login security</h2>
            <span className="count">{data.logins.length}</span>
          </div>
          {data.logins.length ? (
            <ol className="ops-list">
              {data.logins.map((event, index) => {
                const label = event.successful ? "Successful" : event.suspicious ? "Suspicious" : "Rejected";
                const tone = event.successful ? "ok" : event.suspicious ? "bad" : "warn";
                return (
                  <li className="ops-row" key={`${event.createdAt}-${index}`}>
                    <div className="ops-row-head">
                      <strong>Admin login</strong>
                      <span className={`ops-status ops-${tone}`}>{label}</span>
                    </div>
                    <p className="ops-meta"><time dateTime={event.createdAt}>{formatDhaka(event.createdAt)}</time></p>
                  </li>
                );
              })}
            </ol>
          ) : <EmptyLog>No login events recorded.</EmptyLog>}
        </section>
      </div>
    </>
  );
}
