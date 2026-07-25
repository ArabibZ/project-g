import { z } from "zod";

const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", {
  message: "Expected HTTPS URL"
});

export const schedulerStatusSchema = z.enum([
  "waiting",
  "checking",
  "pausing",
  "paused",
  "no_active_sources",
  "error"
]);

export const jobSchema = z.object({
  jobId: z.string().min(1),
  name: z.string().min(1),
  doneCount: z.number().int().nonnegative(),
  totalTarget: z.number().int().positive(),
  payment: z.string().min(1),
  detailsUrl: httpsUrl,
  sourceUrl: httpsUrl,
  firstSeenAt: z.string().min(1)
});

export const dashboardSchema = z.object({
  todayJobs: z.number().int().nonnegative(),
  botUsers: z.object({
    total: z.number().int().nonnegative(),
    on: z.number().int().nonnegative(),
    off: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative()
  }),
  activeSources: z.number().int().nonnegative(),
  totalSources: z.number().int().nonnegative(),
  scheduler: z.object({
    status: schedulerStatusSchema,
    lastCheckAt: z.string().nullable(),
    nextRunAt: z.string().nullable()
  }),
  latestJobs: z.array(jobSchema).max(10)
});

export const botSchema = z.discriminatedUnion("connected", [
  z.object({ connected: z.literal(false) }),
  z.object({
    connected: z.literal(true),
    identity: z.object({
      displayName: z.string().min(1),
      username: z.string().min(1),
      avatarUrl: httpsUrl.nullable()
    }),
    masterEnabled: z.boolean(),
    maskedToken: z.string().min(1)
  })
]);

export const subscriberSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1),
  username: z.string().nullable(),
  status: z.enum(["pending", "active", "off", "unavailable", "blocked"])
});

export const subscribersSchema = z.object({ subscribers: z.array(subscriberSchema) });

export const sourceSchema = z.object({
  id: z.string().uuid(),
  url: httpsUrl,
  normalizedUrl: httpsUrl,
  enabled: z.boolean(),
  position: z.number().int().nonnegative(),
  baselineCompleted: z.boolean(),
  lastCheckedAt: z.string().nullable(),
  lastFailedAt: z.string().nullable(),
  failureCount: z.number().int().nonnegative(),
  lastError: z.string().nullable()
});

export const sourcesSchema = z.object({ sources: z.array(sourceSchema) });
export const jobsSchema = z.object({
  jobs: z.array(jobSchema),
  nextCursor: z.string().nullable()
});

const operationTimestampSchema = z.string().datetime({ offset: true });
export const operationsSchema = z.object({
  runs: z.array(z.object({
    status: z.enum(["running", "succeeded", "partial", "failed"]),
    forcedNotificationsOff: z.boolean(),
    sourcesTotal: z.number().int().nonnegative(),
    sourcesCompleted: z.number().int().nonnegative(),
    validJobsSeen: z.number().int().nonnegative(),
    newJobsSaved: z.number().int().nonnegative(),
    startedAt: operationTimestampSchema,
    finishedAt: operationTimestampSchema.nullable()
  }).strict()).max(12),
  deliveries: z.array(z.object({
    jobId: z.string().min(1).max(80),
    status: z.enum(["pending", "sending", "sent", "skipped", "failed"]),
    attempts: z.number().int().min(0).max(3),
    lastError: z.string().max(180).nullable(),
    createdAt: operationTimestampSchema,
    sentAt: operationTimestampSchema.nullable()
  }).strict()).max(15),
  audits: z.array(z.object({
    action: z.string().min(1).max(80),
    entityType: z.string().min(1).max(80),
    createdAt: operationTimestampSchema
  }).strict()).max(15),
  logins: z.array(z.object({
    successful: z.boolean(),
    suspicious: z.boolean(),
    createdAt: operationTimestampSchema
  }).strict()).max(15)
}).strict();

export const enrollmentSchema = z.object({
  qrCode: z.string().startsWith("data:image/"),
  secret: z.string().min(8),
  uri: z.string().min(1)
});

export const loginResultSchema = z.object({
  next: z.enum(["enroll", "challenge", "dashboard"])
});

export type Bot = z.infer<typeof botSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type Job = z.infer<typeof jobSchema>;
export type Operations = z.infer<typeof operationsSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Subscriber = z.infer<typeof subscriberSchema>;
