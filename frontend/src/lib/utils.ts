import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Parse a "YYYY-MM-DD" string as a local-time Date. Avoids the trap where
// `new Date("2026-01-01")` parses as UTC midnight and then reads back as
// Dec 31 2025 in negative-offset timezones — which silently anchored
// contract-Q math on the wrong month for any day-1 date string.
// Returns null for missing or malformed input.
export function parseISODateLocal(
  s: string | null | undefined,
): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return null;
  }
  return new Date(y, mo - 1, d);
}
