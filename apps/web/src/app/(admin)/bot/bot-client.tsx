"use client";

import { telegramTokenSchema } from "@project-g/shared";
import { useState, type FormEvent } from "react";
import { ConfirmDialog, EmptyState, Notice, StatusPill } from "@/components/ui";
import { api } from "@/lib/api";
import { botSchema, subscribersSchema, type Bot, type Subscriber } from "@/lib/contracts";

type Confirmation = { kind: "disconnect" } | { kind: "replace"; token: string };

function subscriberLabel(status: Subscriber["status"]) {
  if (status === "active") return "On";
  if (status === "blocked") return "Unavailable";
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

export function BotClient({ initialBot, initialSubscribers }: { initialBot: Bot; initialSubscribers: Subscriber[] }) {
  const [bot, setBot] = useState(initialBot);
  const [subscribers, setSubscribers] = useState(initialSubscribers);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation>();

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

  async function runConfirmedAction() {
    if (!confirmation) return;
    const action = confirmation;
    setBusy(action.kind);
    setNotice("");
    try {
      if (action.kind === "disconnect") {
        await api("/api/bot/disconnect", { method: "POST", body: "{}" });
      } else {
        await api("/api/bot/connect", {
          method: "POST",
          body: JSON.stringify({ token: action.token })
        });
        setToken("");
      }
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
      items.map((item) => (item.id === subscriber.id ? { ...item, status: enabled ? "active" : "off" } : item))
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

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Telegram delivery</p>
          <h1>Bot</h1>
          <p>Connection, notification master switch, and subscriber access.</p>
        </div>
      </div>

      {notice || error ? (
        <Notice tone={notice === "Test message queued." ? "success" : "error"}>{notice || error}</Notice>
      ) : null}

      {!bot.connected ? (
        <section className="bot-disconnected" aria-labelledby="bot-not-connected">
          <div>
            <p className="eyebrow">Connection required</p>
            <h2 id="bot-not-connected">Bot not connected</h2>
            <p>Connect Telegram bot token. Token stays server-side and is stored encrypted by Worker.</p>
          </div>
          <form className="token-form" onSubmit={connect}>
            <div className="field">
              <label htmlFor="bot-token">Bot token</label>
              <input
                className="input mono"
                id="bot-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="123456789:AA..."
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
            <button className="button button-primary" type="submit" disabled={Boolean(busy)}>
              {busy === "connect" ? "Connecting..." : "Connect"}
            </button>
          </form>
        </section>
      ) : (
        <>
          <section className="bot-identity">
            <div className="identity-main">
              {bot.identity.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={bot.identity.avatarUrl} alt="" className="bot-avatar" />
              ) : (
                <span className="bot-avatar avatar-fallback" aria-hidden="true">
                  {bot.identity.displayName.charAt(0).toUpperCase()}
                </span>
              )}
              <div>
                <span className="identity-status">
                  <StatusPill tone="good">Connected</StatusPill>
                </span>
                <h2>{bot.identity.displayName}</h2>
                <p>@{bot.identity.username.replace(/^@/, "")}</p>
              </div>
            </div>
            <div className="bot-controls">
              <label className="switch-row">
                <span>
                  <strong>Notifications</strong>
                  <small>{bot.masterEnabled ? "Master delivery is on" : "Master delivery is off"}</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={bot.masterEnabled}
                  disabled={Boolean(busy)}
                  onChange={(event) => void setMaster(event.target.checked)}
                />
              </label>
              <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => void sendTest()}>
                {busy === "test" ? "Sending..." : "Send Test"}
              </button>
            </div>
          </section>

          <section className="token-settings" aria-labelledby="token-settings">
            <div>
              <h2 id="token-settings">Connection token</h2>
              <p><span className="mono">{bot.maskedToken}</span> · Replace only after rotating with BotFather.</p>
            </div>
            <div className="token-inline">
              <input
                className="input mono"
                aria-label="New bot token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="New token"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className="button button-secondary"
                type="button"
                disabled={Boolean(busy) || !token}
                onClick={() => {
                  if (validToken(token)) setConfirmation({ kind: "replace", token: token.trim() });
                }}
              >
                Change token
              </button>
              <button
                className="button button-quiet danger-text"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setConfirmation({ kind: "disconnect" })}
              >
                Disconnect
              </button>
            </div>
          </section>

          <section aria-labelledby="subscribers">
            <div className="section-heading">
              <h2 id="subscribers">Subscribers</h2>
              <span className="muted">{subscribers.length} total</span>
            </div>
            {subscribers.length ? (
              <div className="subscriber-list" role="list">
                {subscribers.map((subscriber) => {
                  const unavailable = subscriber.status === "unavailable" || subscriber.status === "blocked";
                  const enabled = subscriber.status === "active";
                  return (
                    <article className="subscriber-row" role="listitem" key={subscriber.id}>
                      <div className="subscriber-person">
                        <span className="subscriber-avatar" aria-hidden="true">
                          {subscriber.displayName.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <strong>{subscriber.displayName}</strong>
                          <span>{subscriber.username ? `@${subscriber.username.replace(/^@/, "")}` : "No username"}</span>
                        </div>
                      </div>
                      <StatusPill tone={enabled ? "good" : subscriber.status === "pending" ? "warn" : unavailable ? "bad" : "neutral"}>
                        {subscriberLabel(subscriber.status)}
                      </StatusPill>
                      <button
                        className="button button-secondary subscriber-action"
                        type="button"
                        disabled={Boolean(busy) || unavailable}
                        onClick={() => void updateSubscriber(subscriber, !enabled)}
                      >
                        {busy === subscriber.id
                          ? "Saving..."
                          : unavailable
                            ? "Unavailable"
                            : subscriber.status === "pending"
                              ? "Approve"
                              : enabled
                                ? "Turn off"
                                : "Turn on"}
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="No subscribers">New Telegram subscribers appear here as pending.</EmptyState>
            )}
          </section>
        </>
      )}

      <ConfirmDialog
        open={Boolean(confirmation)}
        busy={busy === "disconnect" || busy === "replace"}
        destructive={confirmation?.kind === "disconnect"}
        title={confirmation?.kind === "disconnect" ? "Disconnect bot?" : "Replace bot token?"}
        confirmLabel={confirmation?.kind === "disconnect" ? "Disconnect" : "Replace token"}
        onClose={() => setConfirmation(undefined)}
        onConfirm={() => void runConfirmedAction()}
      >
        <p>
          {confirmation?.kind === "disconnect"
            ? "Notifications stop immediately. Subscriber history remains stored."
            : "Worker verifies new token before replacing current connection."}
        </p>
      </ConfirmDialog>
    </>
  );
}
