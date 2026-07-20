import { z } from "zod";

export const SOURCE_HOST = "bot.gigclickers.com";
export const GENERIC_LOGIN_ERROR = "Email or password incorrect";

export function normalizeSourceUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== SOURCE_HOST ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443")
  ) {
    throw new Error(`URL must use HTTPS on ${SOURCE_HOST}`);
  }
  url.hash = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  return url.toString();
}

export const sourceUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .transform((value, context) => {
    try {
      return normalizeSourceUrl(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid source URL"
      });
      return z.NEVER;
    }
  });

export const browserIdSchema = z.string().uuid();
export const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(1024),
  browserId: browserIdSchema,
  turnstileToken: z.string().min(1).max(2048)
});

export const mfaVerifySchema = z.object({
  factorId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
  refreshToken: z.string().min(1).max(8192)
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(8192)
});

export const passwordSchema = z.object({
  password: z.string().min(12).max(128)
});

export const sourceCreateSchema = z.object({ url: sourceUrlSchema });
export const sourceUpdateSchema = z.object({
  url: sourceUrlSchema.optional(),
  enabled: z.boolean().optional()
}).refine((value) => value.url !== undefined || value.enabled !== undefined);
export const sourceReorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100)
});

export const telegramTokenSchema = z.object({
  token: z.string().regex(/^\d{6,15}:[A-Za-z0-9_-]{30,100}$/)
});

export const subscriberUpdateSchema = z.object({
  enabled: z.boolean()
});

export type ScrapedJob = {
  jobId: string;
  name: string;
  doneCount: number;
  totalTarget: number;
  payment: string;
  detailsUrl: string;
};

export type Source = {
  id: string;
  url: string;
  normalizedUrl: string;
  enabled: boolean;
  position: number;
  baselineCompleted: boolean;
  lastCheckedAt: string | null;
  lastFailedAt: string | null;
  failureCount: number;
  lastError: string | null;
};

export type SchedulerState =
  | "waiting"
  | "checking"
  | "pausing"
  | "paused"
  | "no_active_sources"
  | "error";

export function delayFromSample(sample: number): number {
  const bounded = Math.max(0, Math.min(65_535, Math.trunc(sample)));
  return 240 + Math.floor((bounded * 181) / 65_536);
}

export function dhakaDayStart(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T00:00:00+06:00`;
}

export function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
