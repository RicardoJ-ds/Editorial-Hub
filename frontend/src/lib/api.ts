const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Module-level cache for the current user's email. Populated on first
 * backend call by hitting the Next.js `/api/me` route, which decodes the
 * httpOnly session cookie server-side. Every subsequent backend request
 * forwards the email as `X-User-Email`; the backend's RBAC middleware
 * uses it to resolve permissions + filter responses by pod scope.
 *
 * Trade-off: the backend trusts the header. That's fine because (a) the
 * frontend is the only client that calls the API in production, (b) the
 * header is set by the same Next.js runtime that decodes the JWT, and
 * (c) Cloudflare/Vercel-level network rules block direct backend access
 * from outside the Next.js origin. If we ever expose the API publicly,
 * swap to backend-side JWT verification; the rest of the RBAC stack
 * doesn't need to change.
 */
let cachedEmail: string | null | undefined; // undefined = not fetched yet
let inFlight: Promise<string | null> | null = null;

async function getEmail(): Promise<string | null> {
  if (cachedEmail !== undefined) return cachedEmail;
  if (inFlight) return inFlight;
  inFlight = fetch("/api/me", { credentials: "include" })
    .then(async (r) => {
      if (!r.ok) return null;
      const data = (await r.json()) as { email?: string | null };
      return (data.email || "").trim().toLowerCase() || null;
    })
    .catch(() => null)
    .then((email) => {
      cachedEmail = email;
      return email;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  // Server-side calls (e.g. during Next.js server components) won't be able
  // to hit `/api/me` and don't need the header — they read the session
  // directly. Skip the fetch in that case.
  if (typeof window === "undefined") return headers;
  const email = await getEmail();
  if (email) headers["X-User-Email"] = email;
  // Admin-only "preview as" impersonation. The header is set by the
  // accessClient module; the backend ignores it unless the real caller
  // is admin (so non-admins can't spoof their way past gating).
  try {
    const { getPreviewAs } = await import("@/lib/accessClient");
    const previewAs = getPreviewAs();
    if (previewAs) headers["X-Preview-As"] = previewAs;
  } catch {
    // Module not loaded yet (e.g. initial bootstrap fetch /api/access/me)
    // — that's fine, the request goes through without the header.
  }
  return headers;
}

export async function apiGet<T>(path: string): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiPost<T>(path: string, data: unknown): Promise<T> {
  const headers = await authHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiPut<T>(path: string, data: unknown): Promise<T> {
  const headers = await authHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}${path}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}
