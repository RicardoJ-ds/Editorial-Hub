import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildAuthorizeUrl, randomState } from "@/lib/auth";
import { STATE_COOKIE } from "@/lib/session";

export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/";
  // Pack returnTo into state so we can restore the user's destination after callback.
  const nonce = randomState();
  const state = `${nonce}.${Buffer.from(returnTo).toString("base64url")}`;

  const authorizeUrl = buildAuthorizeUrl(state);
  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10 minutes
  });
  return response;
}
