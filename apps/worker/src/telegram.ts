import { escapeTelegramHtml, telegramTokenSchema } from "@project-g/shared";
import { z } from "zod";
import { decrypt, encrypt, hmac, secureEqual } from "./lib/crypto";
import { adminDb } from "./lib/db";
import { fetchWithTimeout } from "./lib/http";

export const TELEGRAM_WEBHOOK_PATH = "/telegram/webhook";

const DB_TIMEOUT_MS = 10_000;
const TELEGRAM_TIMEOUT_MS = 10_000;
const MAX_WEBHOOK_BYTES = 32_768;
const PENDING_REPLY = "Request received. Waiting for admin approval.";

const safeInteger = z.number().int().refine(Number.isSafeInteger);
const botSettingsSchema = z.object({
  connected: z.boolean(),
  bot_id: safeInteger.nullable(),
  username: z.string().nullable(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  encrypted_token: z.string().nullable(),
  token_iv: z.string().nullable(),
  encrypted_webhook_secret: z.string().nullable(),
  webhook_secret_iv: z.string().nullable(),
  notifications_enabled: z.boolean(),
  connected_at: z.string().nullable(),
  updated_at: z.string()
});

const telegramEnvelopeSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error_code: z.number().int().optional(),
  description: z.string().optional(),
  parameters: z.object({ retry_after: z.number().int().positive().optional() }).optional()
});

const telegramBotSchema = z.object({
  id: safeInteger,
  is_bot: z.literal(true),
  first_name: z.string().min(1),
  username: z.string().optional()
});

const webhookInfoSchema = z.object({
  url: z.string(),
  pending_update_count: z.number().int().nonnegative(),
  last_error_date: z.number().int().optional(),
  last_error_message: z.string().optional()
});

const sentMessageSchema = z.object({ message_id: safeInteger });

const subscriberSchema = z.object({
  id: z.string().uuid(),
  bot_id: safeInteger,
  chat_id: safeInteger,
  telegram_user_id: safeInteger.nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  username: z.string().nullable(),
  status: z.enum(["pending", "active", "off", "unavailable", "blocked"]),
  disabled_by_admin: z.boolean(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  approved_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  updated_at: z.string()
});

const deliverySchema = z.object({
  id: z.string().uuid(),
  job_id: z.string(),
  subscriber_id: z.string().uuid(),
  chat_id: safeInteger,
  attempts: z.number().int().min(0).max(3),
  next_attempt_at: z.string().nullable()
});

const jobSchema = z.object({
  job_id: z.string(),
  name: z.string(),
  done_count: z.number().int().nonnegative(),
  total_target: z.number().int().positive(),
  payment: z.string(),
  details_url: z.string().url()
});

const telegramUpdateSchema = z.object({
  update_id: safeInteger,
  message: z.object({
    text: z.string().optional(),
    chat: z.object({ id: safeInteger, type: z.string() }),
    from: z.object({
      id: safeInteger,
      is_bot: z.boolean(),
      first_name: z.string(),
      last_name: z.string().optional(),
      username: z.string().optional()
    }).optional()
  }).optional(),
  my_chat_member: z.object({
    chat: z.object({ id: safeInteger, type: z.string() }),
    new_chat_member: z.object({ status: z.string() })
  }).optional()
});

type BotSettings = z.infer<typeof botSettingsSchema>;
type SubscriberRow = z.infer<typeof subscriberSchema>;
type TelegramFailureKind = "blocked" | "unavailable" | "temporary" | "permanent";

export class TelegramApiError extends Error {
  readonly kind: TelegramFailureKind;
  readonly retryAfterSeconds: number | null;
  readonly ambiguous: boolean;

  constructor(
    message: string,
    kind: TelegramFailureKind,
    retryAfterSeconds: number | null = null,
    ambiguous = false
  ) {
    super(message);
    this.name = "TelegramApiError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
    this.ambiguous = ambiguous;
  }
}

function dbSignal(): AbortSignal {
  return AbortSignal.timeout(DB_TIMEOUT_MS);
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown error").slice(0, 1000);
}

export function classifyTelegramError(
  status: number,
  code: number,
  description: string,
  retryAfterSeconds: number | null
): TelegramApiError {
  const normalized = description.toLowerCase();
  if (code === 403 && (normalized.includes("blocked") || normalized.includes("kicked"))) {
    return new TelegramApiError("Telegram user blocked bot", "blocked");
  }
  if (
    normalized.includes("chat not found") ||
    normalized.includes("user is deactivated") ||
    normalized.includes("can't initiate conversation") ||
    normalized.includes("cannot initiate conversation") ||
    normalized.includes("bot can't send messages")
  ) {
    return new TelegramApiError("Telegram chat unavailable", "unavailable");
  }
  if (status === 408 || status === 429 || code === 429 || status >= 500 || code >= 500) {
    return new TelegramApiError("Telegram temporarily unavailable", "temporary", retryAfterSeconds);
  }
  return new TelegramApiError("Telegram rejected request", "permanent");
}

async function telegramCall<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
  resultSchema: z.ZodType<T>
): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      },
      TELEGRAM_TIMEOUT_MS
    );
  } catch {
    throw new TelegramApiError("Telegram request outcome unknown", "temporary", null, true);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new TelegramApiError(
      response.ok ? "Invalid Telegram response" : "Telegram request outcome unknown",
      response.status >= 500 ? "temporary" : "permanent",
      null,
      response.ok
    );
  }

  const envelope = telegramEnvelopeSchema.safeParse(raw);
  if (!envelope.success) throw new TelegramApiError("Invalid Telegram response", "permanent");
  if (!response.ok || !envelope.data.ok) {
    throw classifyTelegramError(
      response.status,
      envelope.data.error_code ?? response.status,
      envelope.data.description ?? "",
      envelope.data.parameters?.retry_after ?? null
    );
  }

  const result = resultSchema.safeParse(envelope.data.result);
  if (!result.success) throw new TelegramApiError("Invalid Telegram response", "permanent");
  return result.data;
}

async function readBotSettings(env: Env): Promise<BotSettings> {
  const { data, error } = await adminDb(env)
    .from("telegram_bot_settings")
    .select(
      "connected, bot_id, username, display_name, avatar_url, encrypted_token, token_iv, encrypted_webhook_secret, webhook_secret_iv, notifications_enabled, connected_at, updated_at"
    )
    .eq("singleton", true)
    .abortSignal(dbSignal())
    .single();
  if (error) throw new Error("Unable to load Telegram settings");
  return botSettingsSchema.parse(data);
}

async function connectedBot(env: Env): Promise<{
  settings: BotSettings & { bot_id: number };
  token: string;
  webhookSecret: string;
} | null> {
  const settings = await readBotSettings(env);
  if (!settings.connected) return null;
  if (
    settings.bot_id === null ||
    settings.encrypted_token === null ||
    settings.token_iv === null ||
    settings.encrypted_webhook_secret === null ||
    settings.webhook_secret_iv === null
  ) {
    throw new Error("Telegram settings are incomplete");
  }
  const [token, webhookSecret] = await Promise.all([
    decrypt(settings.encrypted_token, settings.token_iv, env.TOKEN_ENCRYPTION_KEY),
    decrypt(
      settings.encrypted_webhook_secret,
      settings.webhook_secret_iv,
      env.TOKEN_ENCRYPTION_KEY
    )
  ]);
  return { settings: { ...settings, bot_id: settings.bot_id }, token, webhookSecret };
}

function webhookUrl(env: Env): string {
  const base = new URL(env.PUBLIC_API_URL);
  if (base.protocol !== "https:") throw new Error("PUBLIC_API_URL must use HTTPS");
  base.hash = "";
  base.search = "";
  base.pathname = `${base.pathname.replace(/\/$/, "")}${TELEGRAM_WEBHOOK_PATH}`;
  return base.toString();
}

function expectedWebhookSecret(env: Env): Promise<string> {
  return hmac("telegram-webhook-v1", env.SECURITY_HMAC_KEY);
}

async function installWebhook(token: string, url: string, secret: string): Promise<void> {
  await telegramCall(token, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "my_chat_member"],
    drop_pending_updates: false
  }, z.literal(true));
}

async function removeWebhook(token: string): Promise<void> {
  await telegramCall(token, "deleteWebhook", { drop_pending_updates: true }, z.literal(true));
}

async function getWebhookInfo(token: string) {
  return telegramCall(token, "getWebhookInfo", {}, webhookInfoSchema);
}

function maskedToken(token: string): string {
  const separator = token.indexOf(":");
  const id = separator < 0 ? "" : token.slice(0, separator);
  return `${id}:****${token.slice(-4)}`;
}

export type TelegramBotStatus = {
  connected: boolean;
  notificationsEnabled: boolean;
  token: string | null;
  identity: {
    id: string;
    username: string | null;
    displayName: string;
    avatarUrl: string | null;
  } | null;
};

export async function botStatus(env: Env): Promise<TelegramBotStatus> {
  const bot = await connectedBot(env);
  if (!bot) {
    return {
      connected: false,
      notificationsEnabled: false,
      token: null,
      identity: null
    };
  }

  return {
    connected: true,
    notificationsEnabled: bot.settings.notifications_enabled,
    token: maskedToken(bot.token),
    identity: {
      id: String(bot.settings.bot_id),
      username: bot.settings.username,
      displayName: bot.settings.display_name ?? "Telegram bot",
      avatarUrl: bot.settings.avatar_url
    }
  };
}

export async function connectBot(env: Env, rawToken: string): Promise<TelegramBotStatus> {
  const { token } = telegramTokenSchema.parse({ token: rawToken });
  const previous = await connectedBot(env);
  const identity = await telegramCall(token, "getMe", {}, telegramBotSchema);
  const webhookSecret = await expectedWebhookSecret(env);
  const url = webhookUrl(env);
  const [encryptedToken, encryptedSecret] = await Promise.all([
    encrypt(token, env.TOKEN_ENCRYPTION_KEY),
    encrypt(webhookSecret, env.TOKEN_ENCRYPTION_KEY)
  ]);

  await installWebhook(token, url, webhookSecret);
  const webhook = await getWebhookInfo(token);
  if (webhook.url !== url) {
    try {
      await removeWebhook(token);
    } catch {
      // New secret is not stored, so this webhook cannot pass verification.
    }
    throw new Error("Telegram webhook verification failed");
  }

  const { error } = await adminDb(env).rpc("configure_telegram_bot", {
    p_bot_id: identity.id,
    p_username: identity.username ?? null,
    p_display_name: identity.first_name,
    p_avatar_url: null,
    p_encrypted_token: encryptedToken.ciphertext,
    p_token_iv: encryptedToken.iv,
    p_encrypted_webhook_secret: encryptedSecret.ciphertext,
    p_webhook_secret_iv: encryptedSecret.iv
  }).abortSignal(dbSignal());

  if (error) {
    try {
      if (previous?.settings.bot_id === identity.id) {
        await installWebhook(
          previous.token,
          webhookUrl(env),
          previous.webhookSecret
        );
      } else {
        await removeWebhook(token);
      }
    } catch {
      // DB still trusts only previous secret; failed replacement remains rejected.
    }
    throw new Error("Unable to save Telegram connection");
  }

  if (previous && previous.settings.bot_id !== identity.id) {
    try {
      await removeWebhook(previous.token);
    } catch {
      // Old secret was removed from DB; old webhook requests are rejected.
    }
  }
  return botStatus(env);
}

export async function disconnectBot(env: Env): Promise<{ disconnected: true }> {
  const current = await connectedBot(env);
  if (!current) return { disconnected: true };

  await removeWebhook(current.token);
  const { error } = await adminDb(env)
    .rpc("disconnect_telegram_bot")
    .abortSignal(dbSignal());
  if (error) {
    try {
      await installWebhook(
        current.token,
        webhookUrl(env),
        current.webhookSecret
      );
    } catch {
      // Caller receives failure; persisted connection remains source of truth.
    }
    throw new Error("Unable to disconnect Telegram bot");
  }
  return { disconnected: true };
}

export async function setMasterNotifications(
  env: Env,
  enabled: boolean
): Promise<{ enabled: boolean }> {
  const { error } = await adminDb(env)
    .rpc("set_telegram_master_notifications", { p_enabled: enabled })
    .abortSignal(dbSignal());
  if (error) throw new Error("Unable to update Telegram notifications");
  return { enabled };
}

export type TelegramSubscriber = {
  id: string;
  chatId: string;
  telegramUserId: string | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  status: SubscriberRow["status"];
  disabledByAdmin: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  approvedAt: string | null;
};

function publicSubscriber(row: SubscriberRow): TelegramSubscriber {
  return {
    id: row.id,
    chatId: String(row.chat_id),
    telegramUserId: row.telegram_user_id === null ? null : String(row.telegram_user_id),
    firstName: row.first_name,
    lastName: row.last_name,
    username: row.username,
    status: row.status,
    disabledByAdmin: row.disabled_by_admin,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    approvedAt: row.approved_at
  };
}

export async function listSubscribers(env: Env): Promise<TelegramSubscriber[]> {
  const bot = await connectedBot(env);
  if (!bot) return [];
  const { data, error } = await adminDb(env)
    .from("telegram_subscribers")
    .select(
      "id, bot_id, chat_id, telegram_user_id, first_name, last_name, username, status, disabled_by_admin, first_seen_at, last_seen_at, approved_at, archived_at, updated_at"
    )
    .eq("bot_id", bot.settings.bot_id)
    .is("archived_at", null)
    .order("first_seen_at", { ascending: false })
    .abortSignal(dbSignal());
  if (error) throw new Error("Unable to load Telegram subscribers");
  return z.array(subscriberSchema).parse(data).map(publicSubscriber);
}

async function loadCurrentSubscriber(
  env: Env,
  botId: number,
  subscriberId: string
): Promise<SubscriberRow> {
  const { data, error } = await adminDb(env)
    .from("telegram_subscribers")
    .select(
      "id, bot_id, chat_id, telegram_user_id, first_name, last_name, username, status, disabled_by_admin, first_seen_at, last_seen_at, approved_at, archived_at, updated_at"
    )
    .eq("id", subscriberId)
    .eq("bot_id", botId)
    .is("archived_at", null)
    .abortSignal(dbSignal())
    .maybeSingle();
  if (error || !data) throw new Error("Telegram subscriber not found");
  return subscriberSchema.parse(data);
}

async function skipSubscriberDeliveries(env: Env, subscriberId: string, reason: string): Promise<void> {
  const { error } = await adminDb(env)
    .from("notification_deliveries")
    .update({
      status: "skipped",
      next_attempt_at: null,
      lease_until: null,
      last_error: reason,
      updated_at: new Date().toISOString()
    })
    .eq("subscriber_id", subscriberId)
    .eq("status", "pending")
    .abortSignal(dbSignal());
  if (error) throw new Error("Unable to clear subscriber notifications");
}

async function markSubscriberUnavailable(
  env: Env,
  subscriberId: string,
  kind: "blocked" | "unavailable"
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await adminDb(env)
    .from("telegram_subscribers")
    .update({ status: kind, updated_at: now })
    .eq("id", subscriberId)
    .abortSignal(dbSignal());
  if (error) throw new Error("Unable to update Telegram subscriber");
  await skipSubscriberDeliveries(env, subscriberId, `Subscriber ${kind}`);
}

async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  html = false
): Promise<number> {
  const result = await telegramCall(token, "sendMessage", {
    chat_id: chatId,
    text,
    ...(html ? { parse_mode: "HTML", link_preview_options: { is_disabled: true } } : {})
  }, sentMessageSchema);
  return result.message_id;
}

async function sendSubscriberMessage(
  env: Env,
  token: string,
  subscriber: SubscriberRow,
  text: string
): Promise<boolean> {
  try {
    await sendMessage(token, subscriber.chat_id, text);
    return true;
  } catch (error) {
    if (error instanceof TelegramApiError && (error.kind === "blocked" || error.kind === "unavailable")) {
      await markSubscriberUnavailable(env, subscriber.id, error.kind);
      return false;
    }
    throw error;
  }
}

export async function setSubscriberStatus(
  env: Env,
  subscriberId: string,
  enabled: boolean
): Promise<TelegramSubscriber> {
  z.string().uuid().parse(subscriberId);
  const bot = await connectedBot(env);
  if (!bot) throw new Error("Telegram bot is not connected");
  const current = await loadCurrentSubscriber(env, bot.settings.bot_id, subscriberId);
  const alreadySet = enabled
    ? current.status === "active" && !current.disabled_by_admin
    : current.status === "off" && current.disabled_by_admin;
  if (alreadySet) return publicSubscriber(current);

  const now = new Date().toISOString();
  const { data, error } = await adminDb(env)
    .from("telegram_subscribers")
    .update(enabled
      ? {
          status: "active",
          disabled_by_admin: false,
          approved_at: current.approved_at ?? now,
          archived_at: null,
          updated_at: now
        }
      : { status: "off", disabled_by_admin: true, updated_at: now })
    .eq("id", current.id)
    .eq("updated_at", current.updated_at)
    .select(
      "id, bot_id, chat_id, telegram_user_id, first_name, last_name, username, status, disabled_by_admin, first_seen_at, last_seen_at, approved_at, archived_at, updated_at"
    )
    .abortSignal(dbSignal())
    .maybeSingle();
  if (error) throw new Error("Unable to update Telegram subscriber");
  if (!data) return publicSubscriber(await loadCurrentSubscriber(env, bot.settings.bot_id, subscriberId));

  const updated = subscriberSchema.parse(data);
  if (!enabled) await skipSubscriberDeliveries(env, updated.id, "Disabled by admin");
  if (enabled) {
    await sendSubscriberMessage(env, bot.token, updated, "Notifications enabled.");
  } else if (current.status === "active") {
    await sendSubscriberMessage(env, bot.token, updated, "Notifications paused.");
  }
  return publicSubscriber(await loadCurrentSubscriber(env, bot.settings.bot_id, subscriberId));
}

export async function sendTest(
  env: Env,
  subscriberId: string
): Promise<{ sent: boolean }> {
  z.string().uuid().parse(subscriberId);
  const bot = await connectedBot(env);
  if (!bot) throw new Error("Telegram bot is not connected");
  const subscriber = await loadCurrentSubscriber(env, bot.settings.bot_id, subscriberId);
  return {
    sent: await sendSubscriberMessage(env, bot.token, subscriber, "Project G test notification.")
  };
}

async function boundedWebhookJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_WEBHOOK_BYTES) throw new Error("Webhook request too large");
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_WEBHOOK_BYTES) {
    throw new Error("Webhook request too large");
  }
  return JSON.parse(body) as unknown;
}

function cleanName(value: string | undefined, max: number): string | null {
  return value === undefined ? null : value.slice(0, max);
}

async function registerStart(
  env: Env,
  botId: number,
  message: NonNullable<z.infer<typeof telegramUpdateSchema>["message"]>
): Promise<boolean> {
  const sender = message.from;
  if (!sender || sender.is_bot) return false;
  const db = adminDb(env);
  const now = new Date().toISOString();
  const row = {
    bot_id: botId,
    chat_id: message.chat.id,
    telegram_user_id: sender.id,
    first_name: cleanName(sender.first_name, 256),
    last_name: cleanName(sender.last_name, 256),
    username: cleanName(sender.username, 64),
    last_seen_at: now,
    updated_at: now
  };
  const { data: inserted, error: insertError } = await db
    .from("telegram_subscribers")
    .insert(row)
    .select("id")
    .abortSignal(dbSignal())
    .maybeSingle();
  if (inserted) return true;
  if (!insertError || insertError.code !== "23505") {
    throw new Error("Unable to register Telegram subscriber");
  }

  const { data: existing, error: existingError } = await db
    .from("telegram_subscribers")
    .select(
      "id, bot_id, chat_id, telegram_user_id, first_name, last_name, username, status, disabled_by_admin, first_seen_at, last_seen_at, approved_at, archived_at, updated_at"
    )
    .eq("bot_id", botId)
    .eq("chat_id", message.chat.id)
    .abortSignal(dbSignal())
    .single();
  if (existingError) throw new Error("Unable to register Telegram subscriber");
  const subscriber = subscriberSchema.parse(existing);
  const becomesPending = !subscriber.disabled_by_admin && (
    subscriber.status === "unavailable" || subscriber.archived_at !== null
  );
  const { error: updateError } = await db
    .from("telegram_subscribers")
    .update({
      ...row,
      ...(becomesPending ? { status: "pending", archived_at: null } : {})
    })
    .eq("id", subscriber.id)
    .abortSignal(dbSignal());
  if (updateError) throw new Error("Unable to update Telegram subscriber");
  return becomesPending;
}

async function handleChatMemberUpdate(
  env: Env,
  botId: number,
  update: NonNullable<z.infer<typeof telegramUpdateSchema>["my_chat_member"]>
): Promise<void> {
  if (update.chat.type !== "private") return;
  const status = update.new_chat_member.status;
  if (status !== "kicked" && status !== "member") return;
  const db = adminDb(env);
  const { data, error } = await db
    .from("telegram_subscribers")
    .select("id, status")
    .eq("bot_id", botId)
    .eq("chat_id", update.chat.id)
    .is("archived_at", null)
    .abortSignal(dbSignal())
    .maybeSingle();
  if (error) throw new Error("Unable to update Telegram subscriber");
  if (!data) return;
  const id = z.object({ id: z.string().uuid(), status: z.string() }).parse(data);
  if (status === "kicked") {
    await markSubscriberUnavailable(env, id.id, "blocked");
  } else if (id.status === "blocked") {
    const { error: updateError } = await db
      .from("telegram_subscribers")
      .update({ status: "unavailable", updated_at: new Date().toISOString() })
      .eq("id", id.id)
      .eq("status", "blocked")
      .abortSignal(dbSignal());
    if (updateError) throw new Error("Unable to update Telegram subscriber");
  }
}

export async function handleTelegramWebhook(env: Env, request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const suppliedHeader = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const expectedSecret = await expectedWebhookSecret(env);
  if (!(await secureEqual(suppliedHeader, expectedSecret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const bot = await connectedBot(env);
  if (!bot) return new Response("Not Found", { status: 404 });
  if (!(await secureEqual(bot.webhookSecret, expectedSecret))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let parsed: z.infer<typeof telegramUpdateSchema>;
  try {
    parsed = telegramUpdateSchema.parse(await boundedWebhookJson(request));
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (parsed.my_chat_member) {
    await handleChatMemberUpdate(env, bot.settings.bot_id, parsed.my_chat_member);
  }
  const message = parsed.message;
  if (
    !message ||
    message.chat.type !== "private" ||
    !message.text ||
    !/^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(message.text)
  ) {
    return Response.json({ ok: true });
  }

  const reply = await registerStart(env, bot.settings.bot_id, message);
  if (!reply) return Response.json({ ok: true });
  return Response.json({ method: "sendMessage", chat_id: message.chat.id, text: PENDING_REPLY });
}

export function jobMessage(job: z.infer<typeof jobSchema>): string {
  return [
    "<b>NEW</b>",
    `<b>ID:</b> ${escapeTelegramHtml(job.job_id)}`,
    `<b>Name:</b> ${escapeTelegramHtml(job.name)}`,
    `<b>Progress:</b> ${job.done_count}/${job.total_target}`,
    `<b>Payment:</b> ${escapeTelegramHtml(job.payment)}`,
    `<a href="${escapeTelegramHtml(job.details_url)}">Open Job</a>`
  ].join("\n");
}

export function telegramRetryDelaySeconds(
  attempt: number,
  retryAfterSeconds: number | null
): number {
  return Math.max(30 * attempt, retryAfterSeconds ?? 0);
}

async function skipAllPendingDeliveries(env: Env, reason: string): Promise<void> {
  const { error } = await adminDb(env)
    .from("notification_deliveries")
    .update({
      status: "skipped",
      next_attempt_at: null,
      lease_until: null,
      last_error: reason,
      updated_at: new Date().toISOString()
    })
    .eq("status", "pending")
    .abortSignal(dbSignal());
  if (error) throw new Error("Unable to clear Telegram notification backlog");
}

async function finishDelivery(
  env: Env,
  deliveryId: string,
  values: Record<string, unknown>
): Promise<void> {
  const { error } = await adminDb(env)
    .from("notification_deliveries")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", deliveryId)
    .eq("status", "sending")
    .abortSignal(dbSignal());
  if (error) throw new Error("Unable to update Telegram delivery");
}

export type NotificationRetryResult = {
  processed: number;
  sent: number;
  retried: number;
  failed: number;
};

export async function processDueNotifications(
  env: Env,
  limit = 3
): Promise<NotificationRetryResult> {
  const settings = await readBotSettings(env);
  if (!settings.connected || !settings.notifications_enabled) {
    await skipAllPendingDeliveries(env, "Notifications disabled");
    return { processed: 0, sent: 0, retried: 0, failed: 0 };
  }
  const bot = await connectedBot(env);
  if (!bot) return { processed: 0, sent: 0, retried: 0, failed: 0 };

  const now = new Date().toISOString();
  const { error: staleError } = await adminDb(env)
    .from("notification_deliveries")
    .update({
      status: "failed",
      lease_until: null,
      next_attempt_at: null,
      last_error: "Delivery outcome unknown; not retried to avoid duplicate",
      updated_at: now
    })
    .eq("status", "sending")
    .lte("lease_until", now)
    .abortSignal(dbSignal());
  if (staleError) throw new Error("Unable to recover Telegram deliveries");

  const { data, error } = await adminDb(env)
    .from("notification_deliveries")
    .select("id, job_id, subscriber_id, chat_id, attempts, next_attempt_at")
    .eq("status", "pending")
    .lt("attempts", 3)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(3, Math.trunc(limit))))
    .abortSignal(dbSignal());
  if (error) throw new Error("Unable to load due Telegram deliveries");
  const due = z.array(deliverySchema).parse(data);
  const result: NotificationRetryResult = { processed: 0, sent: 0, retried: 0, failed: 0 };

  for (const candidate of due) {
    const leaseUntil = new Date(Date.now() + 60_000).toISOString();
    const attempt = candidate.attempts + 1;
    const { data: claimed, error: claimError } = await adminDb(env)
      .from("notification_deliveries")
      .update({
        status: "sending",
        attempts: attempt,
        next_attempt_at: null,
        lease_until: leaseUntil,
        updated_at: new Date().toISOString()
      })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .eq("attempts", candidate.attempts)
      .select("id")
      .abortSignal(dbSignal())
      .maybeSingle();
    if (claimError) throw new Error("Unable to claim Telegram delivery");
    if (!claimed) continue;
    result.processed += 1;

    const [freshBot, subscriberResult, jobResult] = await Promise.all([
      connectedBot(env),
      adminDb(env)
        .from("telegram_subscribers")
        .select(
          "id, bot_id, chat_id, telegram_user_id, first_name, last_name, username, status, disabled_by_admin, first_seen_at, last_seen_at, approved_at, archived_at, updated_at"
        )
        .eq("id", candidate.subscriber_id)
        .abortSignal(dbSignal())
        .maybeSingle(),
      adminDb(env)
        .from("jobs")
        .select("job_id, name, done_count, total_target, payment, details_url")
        .eq("job_id", candidate.job_id)
        .abortSignal(dbSignal())
        .maybeSingle()
    ]);
    const subscriber = subscriberResult.data ? subscriberSchema.parse(subscriberResult.data) : null;
    const job = jobResult.data ? jobSchema.parse(jobResult.data) : null;
    if (
      subscriberResult.error ||
      jobResult.error ||
      !subscriber ||
      !job ||
      !freshBot ||
      !freshBot.settings.notifications_enabled ||
      freshBot.settings.bot_id !== bot.settings.bot_id ||
      subscriber.bot_id !== freshBot.settings.bot_id ||
      subscriber.status !== "active" ||
      subscriber.disabled_by_admin ||
      subscriber.archived_at !== null
    ) {
      await finishDelivery(env, candidate.id, {
        status: "skipped",
        lease_until: null,
        last_error: "Notification no longer enabled"
      });
      continue;
    }

    try {
      const messageId = await sendMessage(freshBot.token, candidate.chat_id, jobMessage(job), true);
      await finishDelivery(env, candidate.id, {
        status: "sent",
        lease_until: null,
        telegram_message_id: messageId,
        sent_at: new Date().toISOString(),
        last_error: null
      });
      result.sent += 1;
    } catch (sendError) {
      const telegramError = sendError instanceof TelegramApiError ? sendError : null;
      if (telegramError?.kind === "blocked" || telegramError?.kind === "unavailable") {
        await markSubscriberUnavailable(env, candidate.subscriber_id, telegramError.kind);
        await finishDelivery(env, candidate.id, {
          status: "failed",
          lease_until: null,
          last_error: telegramError.message
        });
        result.failed += 1;
      } else if (
        telegramError?.kind === "temporary" &&
        !telegramError.ambiguous &&
        attempt < 3
      ) {
        const retrySeconds = telegramRetryDelaySeconds(attempt, telegramError.retryAfterSeconds);
        await finishDelivery(env, candidate.id, {
          status: "pending",
          lease_until: null,
          next_attempt_at: new Date(Date.now() + retrySeconds * 1000).toISOString(),
          last_error: telegramError.message
        });
        result.retried += 1;
      } else {
        await finishDelivery(env, candidate.id, {
          status: "failed",
          lease_until: null,
          next_attempt_at: null,
          last_error: telegramError?.message ?? errorMessage(sendError)
        });
        result.failed += 1;
      }
    }
  }
  return result;
}

export async function nextNotificationRetryAt(env: Env): Promise<number | null> {
  const [pendingResult, sendingResult] = await Promise.all([
    adminDb(env)
      .from("notification_deliveries")
      .select("next_attempt_at")
      .eq("status", "pending")
      .lt("attempts", 3)
      .order("next_attempt_at", { ascending: true, nullsFirst: true })
      .limit(1)
      .abortSignal(dbSignal())
      .maybeSingle(),
    adminDb(env)
      .from("notification_deliveries")
      .select("lease_until")
      .eq("status", "sending")
      .order("lease_until", { ascending: true, nullsFirst: true })
      .limit(1)
      .abortSignal(dbSignal())
      .maybeSingle()
  ]);
  if (pendingResult.error || sendingResult.error) {
    throw new Error("Unable to schedule Telegram retries");
  }
  const pending = z.object({ next_attempt_at: z.string().nullable() }).nullable().parse(pendingResult.data);
  const sending = z.object({ lease_until: z.string().nullable() }).nullable().parse(sendingResult.data);
  const times = [
    pending ? (pending.next_attempt_at === null ? Date.now() : Date.parse(pending.next_attempt_at)) : null,
    sending?.lease_until ? Date.parse(sending.lease_until) : null
  ].filter((value): value is number => value !== null && Number.isFinite(value));
  return times.length === 0 ? null : Math.min(...times);
}
