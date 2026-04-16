import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Paths that do not require a session cookie.
// Everything else falls through to the (app) layout's session check.
const PUBLIC_PATHS = ["/login", "/api/auth"];

// Presence-only check — the (app) layout still cryptographically verifies
// the JWT. Proxy runs on every request so we keep the hot path cheap.
const SESSION_COOKIE = "eh_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL("/login", request.nextUrl.origin);
  // Preserve deep link so callback can send the user back.
  if (pathname !== "/") {
    loginUrl.searchParams.set(
      "returnTo",
      request.nextUrl.pathname + request.nextUrl.search,
    );
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Skip Next internals and static assets.
  matcher: ["/((?!_next/|favicon.ico|graphite-logo.png|.*\\.).*)"],
};
