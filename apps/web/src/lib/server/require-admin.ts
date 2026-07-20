import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, BROWSER_COOKIE, MFA_FACTOR_COOKIE, REFRESH_COOKIE } from "@/lib/cookie-names";
import { requestWorker, responseError } from "@/lib/server/worker";

export async function requireAdmin(): Promise<void> {
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_COOKIE)?.value;
  const browserId = store.get(BROWSER_COOKIE)?.value;

  if (!accessToken) {
    if (refreshToken) redirect("/api/auth/refresh?returnTo=/dashboard");
    redirect("/login");
  }

  const reply = await requestWorker("auth/me", { accessToken, browserId });
  if (reply.status === 401) {
    if (refreshToken) redirect("/api/auth/refresh?returnTo=/dashboard");
    redirect("/login");
  }
  if (reply.status === 403) {
    const message = responseError(reply.data, "Forbidden");
    if (message === "MFA_REQUIRED") {
      redirect(store.has(MFA_FACTOR_COOKIE) ? "/auth/mfa/challenge" : "/auth/mfa/enroll");
    }
    redirect("/login");
  }
  if (reply.status < 200 || reply.status >= 300) {
    throw new Error("Unable to verify admin session");
  }
}
