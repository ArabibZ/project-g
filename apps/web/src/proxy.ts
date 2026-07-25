import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/cookie-names";

export function proxy(request: NextRequest) {
  if (request.cookies.has(ACCESS_COOKIE)) return NextResponse.next();

  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (request.cookies.has(REFRESH_COOKIE)) {
    const refresh = new URL("/api/auth/refresh", request.url);
    refresh.searchParams.set("returnTo", returnTo);
    return NextResponse.redirect(refresh);
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/bot/:path*",
    "/sources/:path*",
    "/jobs/:path*",
    "/operations/:path*"
  ]
};
