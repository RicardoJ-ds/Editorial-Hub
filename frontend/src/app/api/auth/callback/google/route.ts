import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  exchangeCodeForTokens,
  fetchUserInfo,
  isAllowed,
  ALLOWED_DOMAIN,
} from "@/lib/auth";
import {
  STATE_COOKIE,
  SESSION_COOKIE,
  encryptSession,
} from "@/lib/session";

function errorRedirect(request: NextRequest, reason: string) {
  const url = new URL("/login", request.nextUrl.origin);
  url.searchParams.set("error", reason);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE);
  return res;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const stateParam = params.get("state");
  const oauthError = params.get("error");

  if (oauthError) return errorRedirect(request, oauthError);
  if (!code || !stateParam) return errorRedirect(request, "missing_params");

  const [nonce, returnToB64] = stateParam.split(".");
  const storedNonce = request.cookies.get(STATE_COOKIE)?.value;
  if (!storedNonce || storedNonce !== nonce) {
    return errorRedirect(request, "state_mismatch");
  }

  let returnTo = "/";
  try {
    const decoded = Buffer.from(returnToB64 || "", "base64url").toString();
    if (decoded.startsWith("/") && !decoded.startsWith("//")) returnTo = decoded;
  } catch {
    // fall back to "/"
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    console.error("OAuth token exchange failed:", err);
    return errorRedirect(request, "token_exchange_failed");
  }

  let userInfo;
  try {
    userInfo = await fetchUserInfo(tokens.access_token);
  } catch (err) {
    console.error("OAuth userinfo failed:", err);
    return errorRedirect(request, "userinfo_failed");
  }

  if (!isAllowed(userInfo)) {
    console.warn(
      `Rejected sign-in for ${userInfo.email} (hd=${userInfo.hd ?? "none"}) — not @${ALLOWED_DOMAIN}`,
    );
    return errorRedirect(request, "domain");
  }

  const sessionJwt = await encryptSession({
    sub: userInfo.sub,
    email: userInfo.email,
    name: userInfo.name,
    picture: userInfo.picture,
  });

  const redirectTo = new URL(returnTo, request.nextUrl.origin);
  const response = NextResponse.redirect(redirectTo);
  response.cookies.set(SESSION_COOKIE, sessionJwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  response.cookies.delete(STATE_COOKIE);
  return response;
}
