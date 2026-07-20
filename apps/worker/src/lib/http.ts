import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

export const MAX_JSON_BYTES = 32_768;

export async function parseJson<T extends z.ZodType>(
  context: Context,
  schema: T
): Promise<z.output<T>> {
  const declaredLength = Number(context.req.header("content-length") ?? 0);
  if (declaredLength > MAX_JSON_BYTES) {
    throw new HTTPException(413, { message: "Request too large" });
  }

  const text = await context.req.raw.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new HTTPException(413, { message: "Request too large" });
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON" });
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? "Invalid request" });
  }
  return parsed.data;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10_000
): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export function bearerToken(context: Context): string {
  const authorization = context.req.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  const token = authorization.slice(7);
  if (token.length < 20 || token.length > 8192) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return token;
}
