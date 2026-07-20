import {
  GENERIC_LOGIN_ERROR,
  loginSchema,
  mfaVerifySchema,
  passwordSchema,
  refreshSchema
} from "@project-g/shared";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { hmac } from "./lib/crypto";
import { adminDb, publicAuth, userAuth } from "./lib/db";
import { bearerToken, fetchWithTimeout, parseJson } from "./lib/http";

const claimsSchema = z.object({
  sub: z.string().uuid(),
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  role: z.literal("authenticated"),
  aal: z.enum(["aal1", "aal2"]),
  exp: z.number().int(),
  session_id: z.string().uuid()
});

const adminProfileSchema = z.object({
  id: z.string().uuid(),
  role: z.literal("admin")
});

const turnstileSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional()
});

const recoveryVerifySchema = z.object({
  tokenHash: z.string().min(20).max(2048)
});

export type AdminSession = {
  userId: string;
  email: string;
  aal: "aal1" | "aal2";
  accessToken: string;
};

type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export function validateAdminClaims(
  value: unknown,
  userId: string,
  expectedIssuer: string,
  requireAal2 = true,
  now = Date.now()
) {
  const claims = claimsSchema.safeParse(value);
  if (
    !claims.success ||
    claims.data.sub !== userId ||
    claims.data.iss !== expectedIssuer ||
    !(Array.isArray(claims.data.aud)
      ? claims.data.aud.includes("authenticated")
      : claims.data.aud === "authenticated") ||
    claims.data.exp * 1000 <= now
  ) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  if (requireAal2 && claims.data.aal !== "aal2") {
    throw new HTTPException(403, { message: "MFA_REQUIRED" });
  }
  return claims.data;
}

export function isAdminProfile(value: unknown, userId: string): boolean {
  const profile = adminProfileSchema.safeParse(value);
  return profile.success && profile.data.id === userId;
}

function tokens(session: {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
}): SessionTokens {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt:
      session.expires_at ?? Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600)
  };
}

export async function requireAdmin(
  env: Env,
  accessToken: string,
  requireAal2 = true
): Promise<AdminSession> {
  const auth = publicAuth(env);
  const [{ data: claimsData, error: claimsError }, { data: userData, error: userError }] =
    await Promise.all([auth.auth.getClaims(accessToken), auth.auth.getUser(accessToken)]);

  if (claimsError || userError || !userData.user) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  const claims = validateAdminClaims(
    claimsData?.claims,
    userData.user.id,
    `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`,
    requireAal2
  );

  const db = adminDb(env);
  const [sessionResult, profileResult] = await Promise.all([
    db.rpc("is_auth_session_active", {
      p_user_id: claims.sub,
      p_session_id: claims.session_id
    }),
    db
      .from("profiles")
      .select("id, role")
      .eq("id", claims.sub)
      .eq("role", "admin")
      .maybeSingle()
  ]);
  const activeSession = z.boolean().safeParse(sessionResult.data);
  if (sessionResult.error || !activeSession.success || !activeSession.data) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  const { data: profile, error: profileError } = profileResult;
  if (profileError || !isAdminProfile(profile, claims.sub)) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  return {
    userId: claims.sub,
    email: userData.user.email ?? "",
    aal: claims.aal,
    accessToken
  };
}

export async function adminFromRequest(context: Context, requireAal2 = true) {
  return requireAdmin(context.env as Env, bearerToken(context), requireAal2);
}

async function verifyTurnstile(env: Env, token: string, remoteIp: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET,
          response: token,
          remoteip: remoteIp,
          idempotency_key: crypto.randomUUID()
        })
      },
      8_000
    );
    const result = turnstileSchema.safeParse(await response.json());
    return Boolean(
      result.success &&
      result.data.success &&
      result.data.hostname === env.TURNSTILE_HOSTNAME &&
      result.data.action === "login"
    );
  } catch {
    return false;
  }
}

async function loginIdentity(env: Env, email: string, ip: string, browserId: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const [ipHash, accountHash, browserHash] = await Promise.all([
    hmac(`ip\0${ip}`, env.SECURITY_HMAC_KEY),
    hmac(`account\0${normalizedEmail}`, env.SECURITY_HMAC_KEY),
    hmac(`browser\0${browserId}`, env.SECURITY_HMAC_KEY)
  ]);
  const keyHash = await hmac(`cooldown\0${ipHash}\0${accountHash}`, env.SECURITY_HMAC_KEY);
  return { normalizedEmail, ipHash, accountHash, browserHash, keyHash };
}

async function recordLogin(
  env: Env,
  identity: Awaited<ReturnType<typeof loginIdentity>>,
  successful: boolean,
  reason?: string
) {
  const { data, error } = await adminDb(env).rpc("record_login_event", {
    p_ip_hash: identity.ipHash,
    p_account_hash: identity.accountHash,
    p_browser_hash: identity.browserHash,
    p_key_hash: identity.keyHash,
    p_successful: successful,
    p_failure_reason: reason ?? null
  });
  if (error) throw new Error("Unable to record login security event");
  const [event] = z
    .array(
      z.object({
        failure_count: z.number(),
        cooldown_until: z.string().nullable(),
        suspicious: z.boolean()
      })
    )
    .parse(data);
  if (!event) throw new Error("Login security event was not recorded");
  return event;
}

async function loginGate(env: Env, identity: Awaited<ReturnType<typeof loginIdentity>>) {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const db = adminDb(env);
  const [{ data: cooldown, error: cooldownError }, { count, error: countError }] = await Promise.all([
    db
      .from("login_cooldowns")
      .select("expires_at")
      .eq("key_hash", identity.keyHash)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle(),
    db
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", identity.ipHash)
      .eq("account_hash", identity.accountHash)
      .eq("successful", false)
      .gte("created_at", since)
  ]);
  if (cooldownError || countError) throw new Error("Unable to check login security state");
  return { cooldownUntil: cooldown?.expires_at as string | undefined, failures: count ?? 0 };
}

async function consumeLoginLimit(
  env: Env,
  identity: Awaited<ReturnType<typeof loginIdentity>>
): Promise<boolean> {
  const db = adminDb(env);
  const [ipLimit, accountLimit] = await Promise.all([
    db.rpc("consume_rate_limit", {
      p_key_hash: `login-ip:${identity.ipHash}`,
      p_window_seconds: 900,
      p_limit: 30
    }),
    db.rpc("consume_rate_limit", {
      p_key_hash: `login-account:${identity.accountHash}`,
      p_window_seconds: 900,
      p_limit: 20
    })
  ]);
  if (
    ipLimit.error ||
    accountLimit.error ||
    typeof ipLimit.data !== "boolean" ||
    typeof accountLimit.data !== "boolean"
  ) {
    throw new Error("Unable to enforce rate limit");
  }
  return ipLimit.data && accountLimit.data;
}

export async function login(context: Context, remoteIp: string) {
  const env = context.env as Env;
  const input = await parseJson(context, loginSchema);
  const identity = await loginIdentity(env, input.email, remoteIp, input.browserId);

  if (!(await verifyTurnstile(env, input.turnstileToken, remoteIp))) {
    return context.json({ error: GENERIC_LOGIN_ERROR }, 401);
  }

  const gate = await loginGate(env, identity);
  if (!(await consumeLoginLimit(env, identity)) || gate.cooldownUntil) {
    return context.json(
      { error: GENERIC_LOGIN_ERROR, retryAfter: gate.cooldownUntil ?? undefined },
      429
    );
  }

  if (gate.failures >= 3) {
    await scheduler.wait(Math.min(2_500, 750 * (gate.failures - 2)));
  }

  const auth = publicAuth(env);
  const { data, error } = await auth.auth.signInWithPassword({
    email: identity.normalizedEmail,
    password: input.password
  });
  if (error || !data.session || !data.user) {
    const event = await recordLogin(env, identity, false, "credentials");
    return context.json(
      { error: GENERIC_LOGIN_ERROR, retryAfter: event.cooldown_until ?? undefined },
      event.cooldown_until ? 429 : 401
    );
  }

  const { data: profile } = await adminDb(env)
    .from("profiles")
    .select("id")
    .eq("id", data.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!profile) {
    await recordLogin(env, identity, false, "role");
    return context.json({ error: GENERIC_LOGIN_ERROR }, 401);
  }

  await recordLogin(env, identity, true);
  const { data: factors, error: factorError } = await auth.auth.mfa.listFactors();
  if (factorError) throw new Error("Unable to load MFA factors");
  const session = tokens(data.session);
  const verifiedTotp = factors.totp.filter((factor) => factor.status === "verified");
  return context.json({
    flow: verifiedTotp.length === 0 ? "mfa_enroll" : "mfa_challenge",
    factorId: verifiedTotp[0]?.id ?? null,
    session
  });
}

export async function enrollMfa(context: Context) {
  const env = context.env as Env;
  const accessToken = bearerToken(context);
  await requireAdmin(env, accessToken, false);
  const { refreshToken } = await parseJson(context, refreshSchema);
  const auth = await userAuth(env, accessToken, refreshToken);
  const { data: factors } = await auth.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      await auth.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  const { data, error } = await auth.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Project G admin",
    issuer: "Project G"
  });
  if (error) throw new HTTPException(400, { message: "Unable to enroll authenticator" });
  return context.json({
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri
  });
}

export async function verifyMfa(context: Context) {
  const env = context.env as Env;
  const accessToken = bearerToken(context);
  await requireAdmin(env, accessToken, false);
  const input = await parseJson(context, mfaVerifySchema);
  const auth = await userAuth(env, accessToken, input.refreshToken);
  const { data, error } = await auth.auth.mfa.challengeAndVerify({
    factorId: input.factorId,
    code: input.code
  });
  if (error || !data) {
    throw new HTTPException(400, { message: "Invalid authentication code" });
  }
  await requireAdmin(env, data.access_token, true);
  return context.json({ session: tokens(data) });
}

export async function refreshSession(context: Context) {
  const env = context.env as Env;
  const { refreshToken } = await parseJson(context, refreshSchema);
  const { data, error } = await publicAuth(env).auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) throw new HTTPException(401, { message: "Unauthorized" });
  await requireAdmin(env, data.session.access_token, true);
  return context.json({ session: tokens(data.session) });
}

export async function logout(context: Context) {
  const env = context.env as Env;
  const accessToken = bearerToken(context);
  const { refreshToken } = await parseJson(context, refreshSchema);
  try {
    const auth = await userAuth(env, accessToken, refreshToken);
    await auth.auth.signOut({ scope: "local" });
  } catch {
    // Cookies are cleared by BFF even when upstream session already expired.
  }
  return context.json({ ok: true });
}

export async function verifyRecovery(context: Context) {
  const env = context.env as Env;
  const { tokenHash } = await parseJson(context, recoveryVerifySchema);
  const { data, error } = await publicAuth(env).auth.verifyOtp({
    token_hash: tokenHash,
    type: "recovery"
  });
  if (error || !data.session || !data.user) {
    throw new HTTPException(400, { message: "Recovery link is invalid or expired" });
  }
  const { data: profile } = await adminDb(env)
    .from("profiles")
    .select("id")
    .eq("id", data.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!profile) throw new HTTPException(403, { message: "Forbidden" });
  return context.json({ session: tokens(data.session) });
}

export async function updateRecoveredPassword(context: Context) {
  const env = context.env as Env;
  const accessToken = bearerToken(context);
  const { refreshToken, password } = await parseJson(
    context,
    refreshSchema.extend(passwordSchema.shape)
  );
  const auth = await userAuth(env, accessToken, refreshToken);
  const { error } = await auth.auth.updateUser({ password });
  if (error) throw new HTTPException(400, { message: "Unable to update password" });
  await auth.auth.signOut({ scope: "global" });
  return context.json({ ok: true });
}
