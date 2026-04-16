import "server-only";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "graphitehq.com";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function getOAuthConfig() {
  return {
    clientId: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: requireEnv("AUTH_REDIRECT_URI"),
  };
}

export function buildAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = getOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
    // Limits the account chooser UI to the Graphite Google Workspace.
    // Server-side we still re-verify the `hd` claim + email suffix.
    hd: ALLOWED_DOMAIN,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

type GoogleTokenResponse = {
  access_token: string;
  id_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
};

export async function exchangeCodeForTokens(
  code: string,
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
  hd?: string;
};

export async function fetchUserInfo(
  accessToken: string,
): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Google userinfo failed: ${res.status}`);
  }
  return (await res.json()) as GoogleUserInfo;
}

export function isAllowed(user: GoogleUserInfo): boolean {
  if (!user.email_verified) return false;
  const emailDomain = user.email.split("@")[1]?.toLowerCase();
  if (emailDomain !== ALLOWED_DOMAIN.toLowerCase()) return false;
  // Google's Workspace hosted-domain claim — stronger check than email suffix alone.
  if (user.hd && user.hd.toLowerCase() !== ALLOWED_DOMAIN.toLowerCase()) {
    return false;
  }
  return true;
}

export function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
