import "server-only";

import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "eh_session";
export const STATE_COOKIE = "eh_oauth_state";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionUser = {
  sub: string;
  email: string;
  name: string;
  picture?: string;
};

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or too short (need 32+ chars). Run `openssl rand -base64 32` and set it in .env",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function encryptSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setSubject(user.sub)
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

export async function decryptSession(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    if (
      typeof payload.sub === "string" &&
      typeof payload.email === "string" &&
      typeof payload.name === "string"
    ) {
      return {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        picture:
          typeof payload.picture === "string" ? payload.picture : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function createSession(user: SessionUser): Promise<void> {
  const token = await encryptSession(user);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return decryptSession(token);
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
