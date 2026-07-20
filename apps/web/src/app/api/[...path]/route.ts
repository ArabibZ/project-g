import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  BROWSER_COOKIE,
  MFA_FACTOR_COOKIE,
  REFRESH_COOKIE
} from "@/lib/cookie-names";
import { safeReturnTo } from "@/lib/safe-return-to";
import { requestWorker, type WorkerReply } from "@/lib/server/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 64 * 1024;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const MFA_MAX_AGE = 10 * 60;
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ path: string[] }> };
type SessionTokens = { accessToken: string; refreshToken: string; expiresAt: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestJson(request: NextRequest): Promise<unknown> {
  if (!request.body) return undefined;
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw new Error("JSON_REQUIRED");
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }
  if (length === 0) return undefined;

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function sessionFrom(data: unknown): SessionTokens | undefined {
  if (!isRecord(data) || !isRecord(data.session)) return undefined;
  const session = data.session;
  const accessToken = session.accessToken ?? session.access_token;
  const refreshToken = session.refreshToken ?? session.refresh_token;
  const expiresAt = session.expiresAt ?? session.expires_at;
  if (
    typeof accessToken !== "string" ||
    accessToken.length < 20 ||
    accessToken.length > 8192 ||
    typeof refreshToken !== "string" ||
    refreshToken.length < 1 ||
    refreshToken.length > 8192 ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt)
  ) {
    return undefined;
  }
  return { accessToken, refreshToken, expiresAt };
}

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!isRecord(value)) return value;

  const blocked = new Set(["session", "accessToken", "refreshToken", "access_token", "refresh_token"]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !blocked.has(key))
      .map(([key, item]) => [key, stripSecrets(item)])
  );
}

function setSession(response: NextResponse, session: SessionTokens) {
  const accessMaxAge = Math.max(30, Math.min(3600, Math.floor(session.expiresAt - Date.now() / 1000)));
  response.cookies.set(ACCESS_COOKIE, session.accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: accessMaxAge
  });
  response.cookies.set(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE
  });
}

function clearSession(response: NextResponse) {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, MFA_FACTOR_COOKIE]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0
    });
  }
}

function clearFactor(response: NextResponse) {
  response.cookies.set(MFA_FACTOR_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
}

function finalize(response: NextResponse, browserId: string, setBrowserId: boolean) {
  response.headers.set("cache-control", "no-store");
  if (setBrowserId) {
    response.cookies.set(BROWSER_COOKIE, browserId, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 365 * 24 * 60 * 60
    });
  }
  return response;
}

function sameOrigin(request: NextRequest): boolean {
  if (request.method === "GET") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

function factorId(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const value = data.factorId ?? data.factor_id;
  return typeof value === "string" && UUID.test(value) ? value : undefined;
}

function loginNext(data: unknown): "enroll" | "challenge" | "dashboard" | undefined {
  if (!isRecord(data)) return undefined;
  const value = data.next ?? data.flow;
  if (value === "enroll" || value === "mfa_enroll") return "enroll";
  if (value === "challenge" || value === "mfa_challenge") return "challenge";
  if (value === "dashboard") return "dashboard";
  return undefined;
}

function jsonResponse(reply: WorkerReply): NextResponse {
  return NextResponse.json(stripSecrets(reply.data), { status: reply.status });
}

async function handle(request: NextRequest, context: RouteContext) {
  const { path: parts } = await context.params;
  const browserCookie = request.cookies.get(BROWSER_COOKIE)?.value;
  const browserId = browserCookie && UUID.test(browserCookie) ? browserCookie : crypto.randomUUID();
  const setBrowserId = browserId !== browserCookie;

  if (!ALLOWED_METHODS.has(request.method)) {
    return finalize(NextResponse.json({ error: "Method not allowed" }, { status: 405 }), browserId, setBrowserId);
  }
  if (!sameOrigin(request)) {
    return finalize(NextResponse.json({ error: "Forbidden" }, { status: 403 }), browserId, setBrowserId);
  }
  if (parts.some((part) => part.toLowerCase().includes("webhook"))) {
    return finalize(NextResponse.json({ error: "Not found" }, { status: 404 }), browserId, setBrowserId);
  }

  const path = parts.map(encodeURIComponent).join("/");
  const refreshNavigation = request.method === "GET" && path === "auth/refresh";
  if (request.method === "GET" && path.startsWith("auth/") && !refreshNavigation && path !== "auth/me") {
    return finalize(NextResponse.json({ error: "Method not allowed" }, { status: 405 }), browserId, setBrowserId);
  }

  let body: unknown;
  try {
    body = refreshNavigation ? undefined : await requestJson(request);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_JSON";
    const status = code === "REQUEST_TOO_LARGE" ? 413 : 400;
    const message = code === "REQUEST_TOO_LARGE" ? "Request too large" : code === "JSON_REQUIRED" ? "JSON required" : "Invalid JSON";
    return finalize(NextResponse.json({ error: message }, { status }), browserId, setBrowserId);
  }

  let accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  let refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const existingFactor = request.cookies.get(MFA_FACTOR_COOKIE)?.value;
  const input = isRecord(body) ? body : {};

  if (path === "auth/login") body = { ...input, browserId };
  if (path === "auth/refresh" || path === "auth/logout" || path === "auth/mfa/enroll" || path === "auth/recovery/password") {
    if (!refreshToken) {
      const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      if (path === "auth/logout") clearSession(response);
      return finalize(response, browserId, setBrowserId);
    }
    body = { ...input, refreshToken };
  }
  if (path === "auth/mfa/verify") {
    if (!refreshToken || !existingFactor || !UUID.test(existingFactor)) {
      return finalize(NextResponse.json({ error: "Authentication flow expired" }, { status: 400 }), browserId, setBrowserId);
    }
    body = { ...input, factorId: existingFactor, refreshToken };
  }
  if (path === "auth/recovery/verify") {
    body = { tokenHash: input.tokenHash };
  }

  if (path === "auth/logout" && !accessToken) {
    const response = NextResponse.json({ ok: true });
    clearSession(response);
    return finalize(response, browserId, setBrowserId);
  }

  let reply = await requestWorker(path, {
    method: refreshNavigation ? "POST" : request.method,
    body: request.method === "GET" && !refreshNavigation ? undefined : body,
    accessToken,
    browserId,
    incomingHeaders: request.headers,
    search: refreshNavigation ? undefined : request.nextUrl.search
  });

  let freshSession = sessionFrom(reply.data);
  const canRefresh =
    reply.status === 401 &&
    Boolean(refreshToken) &&
    !path.startsWith("auth/login") &&
    path !== "auth/refresh" &&
    path !== "auth/logout" &&
    path !== "auth/mfa/enroll" &&
    path !== "auth/mfa/verify" &&
    path !== "auth/recovery/verify" &&
    path !== "auth/recovery/password";

  if (canRefresh && refreshToken) {
    const refreshed = await requestWorker("auth/refresh", {
      method: "POST",
      body: { refreshToken },
      browserId,
      incomingHeaders: request.headers
    });
    const tokens = sessionFrom(refreshed.data);
    if (refreshed.status >= 200 && refreshed.status < 300 && tokens) {
      freshSession = tokens;
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
      reply = await requestWorker(path, {
        method: request.method,
        body: request.method === "GET" ? undefined : body,
        accessToken,
        browserId,
        incomingHeaders: request.headers,
        search: request.nextUrl.search
      });
    }
  }

  if (refreshNavigation) {
    if (reply.status >= 200 && reply.status < 300 && freshSession) {
      const response = NextResponse.redirect(new URL(safeReturnTo(request.nextUrl.searchParams.get("returnTo")), request.url));
      setSession(response, freshSession);
      return finalize(response, browserId, setBrowserId);
    }
    const response = NextResponse.redirect(new URL("/login", request.url));
    clearSession(response);
    return finalize(response, browserId, setBrowserId);
  }

  let response: NextResponse;
  if (path === "auth/login" && reply.status >= 200 && reply.status < 300) {
    const next = loginNext(reply.data);
    const pendingFactor = factorId(reply.data);
    if (!freshSession || !next || (next === "challenge" && !pendingFactor)) {
      freshSession = undefined;
      response = NextResponse.json({ error: "Authentication response incomplete" }, { status: 502 });
    } else {
      response = NextResponse.json({ next });
      if (pendingFactor) {
        response.cookies.set(MFA_FACTOR_COOKIE, pendingFactor, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: MFA_MAX_AGE
        });
      }
      if (next === "dashboard") clearFactor(response);
    }
  } else if (path === "auth/mfa/enroll" && reply.status >= 200 && reply.status < 300) {
    const pendingFactor = factorId(reply.data);
    if (!pendingFactor) {
      response = NextResponse.json({ error: "Enrollment response incomplete" }, { status: 502 });
    } else {
      response = jsonResponse(reply);
      response.cookies.set(MFA_FACTOR_COOKIE, pendingFactor, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: MFA_MAX_AGE
      });
    }
  } else if (path === "auth/mfa/verify" && reply.status >= 200 && reply.status < 300) {
    if (!freshSession) {
      response = NextResponse.json({ error: "Authentication response incomplete" }, { status: 502 });
    } else {
      response = NextResponse.json({ next: "dashboard" });
      clearFactor(response);
    }
  } else if (path === "auth/refresh" && reply.status >= 200 && reply.status < 300) {
    if (!freshSession) {
      response = NextResponse.json({ error: "Authentication response incomplete" }, { status: 502 });
    } else {
      response = NextResponse.json({ ok: true });
    }
  } else if (path === "auth/recovery/verify" && reply.status >= 200 && reply.status < 300) {
    if (!freshSession) {
      response = NextResponse.json({ error: "Authentication response incomplete" }, { status: 502 });
    } else {
      response = NextResponse.json({ ok: true });
    }
  } else {
    response = jsonResponse(reply);
  }

  if (freshSession) setSession(response, freshSession);
  if (path === "auth/logout") clearSession(response);
  if (path === "auth/recovery/password" && reply.status >= 200 && reply.status < 300) clearSession(response);
  if (reply.status === 401 && canRefresh && !freshSession) clearSession(response);
  return finalize(response, browserId, setBrowserId);
}

async function route(request: NextRequest, context: RouteContext) {
  try {
    return await handle(request, context);
  } catch (error) {
    console.error("BFF request failed", error instanceof Error ? error.message : error);
    const response = NextResponse.json(
      { error: "Service unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } }
    );
    if (request.nextUrl.pathname === "/api/auth/logout") clearSession(response);
    const existingBrowserId = request.cookies.get(BROWSER_COOKIE)?.value;
    const browserId = existingBrowserId && UUID.test(existingBrowserId) ? existingBrowserId : crypto.randomUUID();
    return finalize(response, browserId, browserId !== existingBrowserId);
  }
}

export const GET = route;
export const POST = route;
export const PUT = route;
export const PATCH = route;
export const DELETE = route;
