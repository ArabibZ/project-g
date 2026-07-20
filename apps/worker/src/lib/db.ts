import { createClient } from "@supabase/supabase-js";

const authOptions = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false
  }
} as const;

export function adminDb(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, authOptions);
}

export function publicAuth(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, authOptions);
}

export async function userAuth(env: Env, accessToken: string, refreshToken: string) {
  const client = publicAuth(env);
  const { error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });
  if (error) throw new Error("Invalid session");
  return client;
}
