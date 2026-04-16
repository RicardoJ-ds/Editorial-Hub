import Image from "next/image";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ALLOWED_DOMAIN } from "@/lib/auth";

const ERROR_MESSAGES: Record<string, string> = {
  domain: `Sign-in restricted to @${process.env.ALLOWED_EMAIL_DOMAIN || "graphitehq.com"} accounts.`,
  state_mismatch: "Your sign-in session expired. Please try again.",
  token_exchange_failed: "Could not complete Google sign-in. Please try again.",
  userinfo_failed: "Could not load your Google profile. Please try again.",
  missing_params: "Sign-in was cancelled or incomplete.",
  access_denied: "Sign-in was cancelled.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/");

  const { error, returnTo } = await searchParams;
  const errorMessage = error ? ERROR_MESSAGES[error] || "Sign-in failed." : null;
  const loginHref = returnTo
    ? `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`
    : "/api/auth/login";

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-8 rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] p-10 shadow-2xl">
      <div className="flex flex-col items-center gap-4">
        <Image
          src="/graphite-logo.png"
          alt="Graphite"
          width={48}
          height={48}
          priority
        />
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-lg font-semibold text-white">Editorial Hub</h1>
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            Graphite internal
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="w-full rounded-md border border-[#ED6958]/30 bg-[#ED6958]/10 px-3 py-2 text-xs text-[#ED6958]">
          {errorMessage}
        </div>
      )}

      <a
        href={loginHref}
        className="flex w-full items-center justify-center gap-3 rounded-md bg-white px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-[#e6e6e6]"
      >
        <GoogleIcon />
        Sign in with Google
      </a>

      <p className="text-center font-mono text-[10px] uppercase tracking-wider text-[#606060]">
        Access limited to @{ALLOWED_DOMAIN} accounts
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
