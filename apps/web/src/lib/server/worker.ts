import "server-only";

import { isIP } from "node:net";

const MAX_RESPONSE_BYTES = 1024 * 1024;

export type WorkerReply = {
  data: unknown;
  receivedAt: number;
  status: number;
};

type WorkerRequest = {
  accessToken?: string | undefined;
  body?: unknown;
  browserId?: string | undefined;
  incomingHeaders?: Headers | undefined;
  method?: string | undefined;
  search?: string | undefined;
};

function config() {
  const base = process.env.WORKER_API_URL;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!base || !secret) throw new Error("Worker BFF environment is not configured");

  const url = new URL(base);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) {
    throw new Error("WORKER_API_URL must use HTTPS");
  }
  return { base: url, secret };
}

function firstValidIp(value: string | null): string | undefined {
  for (const item of value?.split(",") ?? []) {
    const candidate = item.trim();
    if (candidate.length <= 45 && isIP(candidate) !== 0) return candidate;
  }
  return undefined;
}

function clientIpHeaders(incoming: Headers): HeadersInit {
  const vercelIp = firstValidIp(incoming.get("x-vercel-forwarded-for"));
  const cloudflareIp = firstValidIp(incoming.get("cf-connecting-ip"));
  const clientIp = process.env.VERCEL ? vercelIp : cloudflareIp ?? vercelIp;
  if (!clientIp) return {};

  return {
    "x-client-ip": clientIp
  };
}

async function boundedJson(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw new Error("Worker returned a non-JSON response");
  }

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Worker response is too large");
  if (!response.body) throw new Error("Worker returned an empty response");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Worker response is too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("Worker returned invalid JSON");
  }
}

export async function requestWorker(path: string, options: WorkerRequest = {}): Promise<WorkerReply> {
  const { base, secret } = config();
  const url = new URL(`/api/${path}`, base);
  if (options.search) url.search = options.search;

  const headers = new Headers({
    accept: "application/json",
    "x-internal-api-secret": secret,
    ...(options.incomingHeaders ? clientIpHeaders(options.incomingHeaders) : {})
  });
  if (options.accessToken) headers.set("authorization", `Bearer ${options.accessToken}`);
  if (options.browserId) headers.set("x-browser-id", options.browserId);
  if (options.body !== undefined) headers.set("content-type", "application/json");

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000)
  });

  const responseDate = Date.parse(response.headers.get("date") ?? "");
  return {
    data: await boundedJson(response),
    receivedAt: Number.isNaN(responseDate) ? Date.now() : responseDate,
    status: response.status
  };
}

export function responseError(data: unknown, fallback: string): string {
  if (typeof data !== "object" || data === null) return fallback;
  const record = data as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.length <= 300) return record.error;
  if (typeof record.message === "string" && record.message.length <= 300) return record.message;
  return fallback;
}
