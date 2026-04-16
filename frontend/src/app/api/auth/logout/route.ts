import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(
    new URL("/login", request.nextUrl.origin),
    { status: 303 },
  );
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

// Allow GET for direct-link logout (e.g., email links, dev convenience)
export const GET = POST;
