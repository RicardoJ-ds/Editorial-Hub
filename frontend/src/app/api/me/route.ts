import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

/**
 * Whoami endpoint — the frontend's API client (`lib/api.ts`) calls this
 * once on app mount to learn the current user's email, then forwards it
 * as `X-User-Email` on every backend request. The cookie is `httpOnly`
 * so the browser can't read it directly; this server-route is the only
 * way to surface the email to client components.
 */
export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ email: null }, { status: 401 });
  }
  return NextResponse.json({
    email: user.email,
    name: user.name,
    picture: user.picture,
  });
}
