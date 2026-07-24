"use client";

import { telegramTokenSchema } from "@project-g/shared";
import { useId, useState, type FormEvent } from "react";
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  IconBot,
  Notice,
  Pill
} from "@/components/ui";
import { api } from "@/lib/api";
import { botSchema, subscribersSchema, type Bot, type Subscriber } from "@/lib/contracts";
import { initialsOf } from "@/lib/format";

type Confirmation = { kind: "disconnect" };

/* Repo mapping: active → "On", blocked → "Unavailable", rest capitalized. */
function subscriberLabel(status: Subscriber["status"]): string {
  if (status === "active") return "On";
  if (status === "blocked") return "Unavailable";
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

function subscriberTone(status: Subscriber["status"]): "ok" | "warn" | "bad" | "neutral" {
  if (status === "active") return "ok";
  if (status === "pending") return "warn";
  if (status === "unavailable" || status === "blocked") return "bad";
  return "neutral";
}

/* ---------------- replace-token dialog ---------------- */

function ReplaceTokenDialog({
  onClose,
  onDone
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const id = useId();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!telegramTokenSchema.safeParse({ token: token.trim() }).success) {
      setError("Enter a valid Telegram bot token.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/bot/connect", {
        method: "POST",
        body: JSON.stringify({ token: token.trim() })
      });
      await onDone();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Bot update failed");
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={() => !busy && onClose()} labelledBy={`${id}-title`}>
      <form className="dialog-panel" onSubmit={submit}>
        <div className="dialog-head">
          <p className="microlabel">Connection token</p>
          <h2 id={`${id}-title`}>Replace bot token?</h2>
        </div>
        <div className="dialog-copy">
          <p>
            Worker verifies the new token with Telegram before replacing the current connection.
            Replace only after rotating with BotFather.
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${id}-token`}>New bot token</label>
          <input
            className="input mono"
            id={`${id}-token`}
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="123456789:AA…"
            autoComplete="off"
            spellCheck={false}
            required
            autoFocus
            disabled={busy}
            aria-invalid={error ? true : undefined}
          />
        </div>
        {error ? <Notice>{error}</Notice> : null}
        <div className="dialog-actions">
          <Button variant="quiet" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy} busyLabel="Verifying…">
            Verify & replace
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ---------------- page ---------------- */

export function BotClient({
  initialBot,
  initialSubscribers
}: {
  initialBot: Bot;
  initialSubscribers: Subscriber[];
}) {
  const [bot, setBot] = useState(initialBot);
  const [subscribers, setSubscribers] = useState(initialSubscribers);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [replacing, setReplacing] = useState(false);

  async function load() {
    try {
      const nextBot = botSchema.parse(await api("/api/bot"));
      setError("");
      setBot(nextBot);
      if (nextBot.connected) {
        const result = subscribersSchema.parse(await api("/api/bot/subscribers"));
        setSubscribers(result.subscribers);
      } else {
        setSubscribers([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Bot request failed");
    }
  }

  function validToken(value: string): boolean {
    if (telegramTokenSchema.safeParse({ token: value.trim() }).success) return true;
    setNotice("Enter a valid Telegram bot token.");
    return false;
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validToken(token)) return;
    setBusy("connect");
    setNotice("");
    try {
      await api("/api/bot/connect", { method: "POST", body: JSON.stringify({ token: token.trim() }) });
      setToken("");
      await load();
    } catch (mutationError) {
      setNotice(mutationError instanceof Error ? mutationError.message : "Connection failed");
    } finally {
      setBusy("");
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setNotice("");
    try {
      await api("/api/bot/disconnect", { method: "POST", body: "{}" });
      setConfirmation(undefined);
      await load();
    } catch (mutationError) {
      setNotice(mutationError instanceof Error ? mutationError.message : "Bot update failed");
    } finally {
      setBusy("");
    }
  }

  async function setMaster(enabled: boolean) {
    if (!bot.connected) return;
    const previous = bot;
    setBot({ ...bot, masterEnabled: enabled });
    setBusy("master");
    setNotice("");
    try {
      await api("/api/bot/master", {
        method: "PATCH",
        body: JSON.stringify({ enabled })
      });
    } catch (mutationError) {
      setBot(previous);
      setNotice(mutationError instanceof Error ? mutationError.message : "Master switch failed");
    } finally {
      setBusy("");
    }
  }

  async function sendTest() {
    setBusy("test");
    setNotice("");
    try {
      await api("/api/bot/test", { method: "POST", body: "{}" });
      setNotice("Test message queued.");
    } catch (mutationError) {
      setNotice(mutationError instanceof Error ? mutationError.message : "Test message failed");
    } finally {
      setBusy("");
    }
  }

  async function updateSubscriber(subscriber: Subscriber, enabled: boolean) {
    const previous = subscribers;
    setBusy(subscriber.id);
    setNotice("");
    setSubscribers((items) =>
      items.map((item) =>
        item.id === subscriber.id ? { ...item, status: enabled ? "active" : "off" } : item
      )
    );
    try {
      await api(`/api/bot/subscribers/${encodeURIComponent(subscriber.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled })
      });
    } catch (mutationError) {
      setSubscribers(previous);
      setNotice(mutationError instanceof Error ? mutationError.message : "Subscriber update failed");
    } finally {
      setBusy("");
    }
  }

  const banner = notice || error;
  const bannerTone = notice === "Test message queued." ? "success" : "error";

  if (!bot.connected) {
    return (
      <>
        {banner ? (
          <div style={{ marginBottom: 14 }}>
            <Notice tone={bannerTone}>{banner}</Notice>
          </div>
        ) : null}
        <section className="connect-hero" aria-labelledby="bot-not-connected">
          <p className="microlabel on-accent">Telegram delivery · connection required</p>
          <h1 id="bot-not-connected">Bot not connected</h1>
          <p className="copy">
            Connect a Telegram bot token from BotFather. The token is verified with Telegram, stays
            server-side, and is stored encrypted by the Worker — it is never shown again in full.
          </p>
          <form className="token-form" onSubmit={connect}>
            <div className="field">
              <label htmlFor="bot-token">Bot token</label>
              <input
                className="input mono"
                id="bot-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="123456789:AA…"
                autoComplete="off"
                spellCheck={false}
                required
                disabled={busy === "connect"}
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              className="btn-lg"
              busy={busy === "connect"}
              busyLabel="Connecting…"
            >
              Connect bot
            </Button>
          </form>
        </section>
      </>
    );
  }

  return (
    <>
      {banner && !confirmation && !replacing ? (
        <div style={{ marginBottom: 14 }}>
          <Notice tone={bannerTone}>{banner}</Notice>
        </div>
      ) : null}

      <div className="split">
        <section className="split-intro" aria-labelledby="bot-page-title">
          <div className="profile">
            <div className="profile-context">
              <p className="microlabel">Connected delivery</p>
              <h1 id="bot-page-title">Telegram Bot</h1>
            </div>
            {bot.identity.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="avatar" src={bot.identity.avatarUrl} alt="" width={76} height={76} />
            ) : (
              <span className="avatar" aria-hidden="true">
                {initialsOf(bot.identity.displayName)}
              </span>
            )}
            <div className="profile-name">
              <h2>{bot.identity.displayName}</h2>
              <span className="username">@{bot.identity.username.replace(/^@/, "")}</span>
            </div>
            <Pill tone="ok">Connected</Pill>

            <label className="master-row">
              <span className="labels">
                <strong>Job notifications</strong>
                <small>{bot.masterEnabled ? "Master delivery is on" : "Master delivery is off"}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={bot.masterEnabled}
                disabled={Boolean(busy)}
                onChange={(event) => void setMaster(event.target.checked)}
              />
            </label>

            <div className="profile-actions">
              <Button
                variant="secondary"
                disabled={Boolean(busy)}
                busy={busy === "test"}
                busyLabel="Sending…"
                onClick={() => void sendTest()}
              >
                Send test
              </Button>
              <Button
                variant="secondary"
                disabled={Boolean(busy)}
                onClick={() => {
                  setNotice("");
                  setReplacing(true);
                }}
              >
                Change token…
              </Button>
              <Button
                variant="danger-quiet"
                disabled={Boolean(busy)}
                onClick={() => {
                  setNotice("");
                  setConfirmation({ kind: "disconnect" });
                }}
              >
                Disconnect…
              </Button>
            </div>

            <div className="token-line">
              <p className="microlabel">Connection token</p>
              <code title="Stored encrypted; shown masked only">{bot.maskedToken}</code>
            </div>
          </div>
        </section>

        <section aria-labelledby="subscribers">
          <div className="section-head">
            <h2 id="subscribers">
              Subscribers <span className="count">· {subscribers.length} total</span>
            </h2>
          </div>
          {subscribers.length ? (
            <div className="dlist">
              <ul>
                {subscribers.map((subscriber, index) => {
                  const unavailable =
                    subscriber.status === "unavailable" || subscriber.status === "blocked";
                  const enabled = subscriber.status === "active";
                  return (
                    <li key={subscriber.id} style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
                      <article className="sub-row">
                        <div className="sub-person">
                          <span className="sub-avatar" aria-hidden="true">
                            {initialsOf(subscriber.displayName)}
                          </span>
                          <div>
                            <strong>{subscriber.displayName}</strong>
                            <span>
                              {subscriber.username
                                ? `@${subscriber.username.replace(/^@/, "")}`
                                : "No username"}
                            </span>
                          </div>
                        </div>
                        <Pill tone={subscriberTone(subscriber.status)} hollow={subscriber.status === "off"}>
                          {subscriberLabel(subscriber.status)}
                        </Pill>
                        <span className="sub-action">
                          <Button
                            variant={subscriber.status === "pending" ? "primary" : "secondary"}
                            disabled={Boolean(busy) || unavailable}
                            busy={busy === subscriber.id}
                            busyLabel="Saving…"
                            onClick={() => void updateSubscriber(subscriber, !enabled)}
                            style={{ minWidth: 104 }}
                          >
                            {unavailable
                              ? "Unavailable"
                              : subscriber.status === "pending"
                                ? "Approve"
                                : enabled
                                  ? "Turn off"
                                  : "Turn on"}
                          </Button>
                        </span>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <EmptyState title="No subscribers" icon={<IconBot size={18} />}>
              New Telegram subscribers appear here as pending.
            </EmptyState>
          )}
        </section>
      </div>

      {replacing ? (
        <ReplaceTokenDialog
          onClose={() => setReplacing(false)}
          onDone={async () => {
            setReplacing(false);
            await load();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmation)}
        busy={busy === "disconnect"}
        destructive
        title="Disconnect bot?"
        confirmLabel="Disconnect"
        onClose={() => {
          setConfirmation(undefined);
          setNotice("");
        }}
        onConfirm={() => void disconnect()}
      >
        <p>Notifications stop immediately. Subscriber history remains stored.</p>
        {notice ? <Notice>{notice}</Notice> : null}
      </ConfirmDialog>
    </>
  );
}
