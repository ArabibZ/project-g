import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, BROWSER_COOKIE, MFA_FACTOR_COOKIE, REFRESH_COOKIE } from "@/lib/cookie-names";
import { safeReturnTo } from "@/lib/safe-return-to";
import { requestWorker, responseError, type WorkerReply } from "@/lib/server/worker";

export async function requestAdminData(path: string, returnTo: string, search?: string): Promise<WorkerReply> {
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_COOKIE)?.value;
  const browserId = store.get(BROWSER_COOKIE)?.value;
  const factorId = store.get(MFA_FACTOR_COOKIE)?.value;
  const refreshUrl = `/api/auth/refresh?${new URLSearchParams({ returnTo: safeReturnTo(returnTo) })}`;

  if (!accessToken) {
    if (refreshToken) redirect(refreshUrl);
    redirect("/login");
  }

  const reply = await requestWorker(path, { accessToken, browserId, search });
  if (reply.status === 401) {
    if (refreshToken) redirect(refreshUrl);
    redirect("/login");
  }
  if (reply.status === 403) {
    const message = responseError(reply.data, "Forbidden");
    if (message === "MFA_REQUIRED") {
      redirect(factorId ? "/auth/mfa/challenge" : "/auth/mfa/enroll");
    }
    redirect("/login");
  }
  if (reply.status < 200 || reply.status >= 300) {
    throw new Error("Unable to load admin data");
  }
  return reply;
}
