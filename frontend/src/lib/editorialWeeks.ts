/**
 * Editorial week distribution — defines when each Editorial month begins for
 * "as of" math. Source of truth: the `editorial_weeks` table, populated by
 * the past-months resync from the Master Tracker's "{Year} Week Distribution"
 * tabs. Frontend reads it through `useEditorialAsOf()` in `editorialWeeksClient`.
 *
 * The Editorial calendar diverges from the Gregorian calendar by a few days:
 * Week 1 of an Editorial month doesn't always start on the 1st (e.g. May
 * Editorial 2026 starts on May 6, not May 1). Until Week 1 of month X has
 * begun, the team is still operating in month X-1 — which is why "As of"
 * badges shouldn't blindly use `now.getMonth() - 1`.
 */
export interface EditorialWeek {
  year: number;
  /** 1-12. */
  month: number;
  /** 1-based ordinal within the month — typically 1..4 or 1..5. */
  weekNumber: number;
  /** ISO YYYY-MM-DD, inclusive. */
  start: string;
  /** ISO YYYY-MM-DD, inclusive. */
  end: string;
}

export interface EditorialAsOf {
  /** Human label like "April 2026" — last fully-completed Editorial month. */
  label: string;
  /** True when we couldn't pin "today" inside any known Editorial month
   *  (year not yet imported, or DB empty). The badge surfaces a "cal." chip
   *  in that case to flag the calendar-month fallback. */
  isFallback: boolean;
}

const MONTH_NAMES_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function isoToLocalDate(iso: string): Date {
  // Parse "YYYY-MM-DD" without TZ shifts so a 2026-05-06 string compares
  // against `new Date()` correctly regardless of the user's locale.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function calendarFallback(now: Date): EditorialAsOf {
  const calY = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const calM = now.getMonth() === 0 ? 12 : now.getMonth();
  return {
    label: `${MONTH_NAMES_LONG[calM - 1]} ${calY}`,
    isFallback: true,
  };
}

/** Calendar days of grace after an Editorial month's last day before the
 *  "As of" badge treats that month as fully closed. Editorial months end on a
 *  Tuesday (the last week's `end`); the team finishes closing the books on the
 *  Wednesday after, so the badge should only advance to that month on the
 *  Thursday (Tuesday + 2 days). Keeps "As of <month>" honest — it never claims
 *  a month is final while the team is still wrapping it up. */
const CLOSE_GRACE_DAYS = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** "Last completed Editorial month" relative to `now`, given the imported
 *  weeks. Returns calendar-month fallback (with `isFallback: true`) when
 *  weeks is empty or today's date sits outside every known Editorial month. */
export interface CurrentEditorialMonth {
  /** 1-12, the team's currently-in-progress Editorial month. */
  month: number;
  year: number;
  label: string;
  isFallback: boolean;
}

/** Current Editorial month — the one whose Week 1 has begun and whose
 *  next month's Week 1 hasn't yet. Returns calendar-month fallback when
 *  the weeks data doesn't cover today. Used by the Monthly Goals gauges
 *  on D1 so the rings show progress against THIS month's goal sheet,
 *  independent of the user's date-range filter. */
export function currentEditorialMonth(
  now: Date,
  weeks: EditorialWeek[],
): CurrentEditorialMonth {
  const todayMs = now.getTime();
  let current: { year: number; month: number; startMs: number } | null = null;
  for (const w of weeks) {
    if (w.weekNumber !== 1) continue;
    const startMs = isoToLocalDate(w.start).getTime();
    if (startMs > todayMs) continue;
    if (!current || startMs > current.startMs) {
      current = { year: w.year, month: w.month, startMs };
    }
  }
  if (!current) {
    return {
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      label: `${MONTH_NAMES_LONG[now.getMonth()]} ${now.getFullYear()}`,
      isFallback: true,
    };
  }
  return {
    month: current.month,
    year: current.year,
    label: `${MONTH_NAMES_LONG[current.month - 1]} ${current.year}`,
    isFallback: false,
  };
}


export function lastCompletedEditorialAsOf(
  now: Date,
  weeks: EditorialWeek[],
): EditorialAsOf {
  if (weeks.length === 0) return calendarFallback(now);

  // Compare on whole-day granularity (drop the time of day) so the badge flips
  // at the START of the rollover day, not at whatever hour the page is loaded.
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();

  // Each Editorial month's last day (its last week's `end`, a Tuesday), plus
  // the latest end across all imported weeks (our coverage horizon).
  const lastDayByMonth = new Map<
    string,
    { year: number; month: number; endMs: number }
  >();
  let coverageEndMs = -Infinity;
  for (const w of weeks) {
    const endMs = isoToLocalDate(w.end).getTime();
    if (endMs > coverageEndMs) coverageEndMs = endMs;
    const key = `${w.year}-${w.month}`;
    const prev = lastDayByMonth.get(key);
    if (!prev || endMs > prev.endMs) {
      lastDayByMonth.set(key, { year: w.year, month: w.month, endMs });
    }
  }

  // Today has run past every imported week — the new year's "Week Distribution"
  // tab isn't loaded yet, so we genuinely don't know the current month. Fall
  // back to the calendar (with the `· cal.` chip) rather than name a stale one.
  if (today > coverageEndMs) return calendarFallback(now);

  // Last completed = the latest Editorial month whose close has passed, i.e.
  // (last day + grace) is on or before today. The grace gives the team
  // Wednesday to close the books; the badge advances on the Thursday.
  let best: { year: number; month: number; endMs: number } | null = null;
  for (const m of lastDayByMonth.values()) {
    if (m.endMs + CLOSE_GRACE_DAYS * MS_PER_DAY <= today) {
      if (!best || m.endMs > best.endMs) best = m;
    }
  }

  // Today precedes the close of even the earliest known month — too early to
  // name a completed Editorial month. Calendar fallback.
  if (!best) return calendarFallback(now);

  return {
    label: `${MONTH_NAMES_LONG[best.month - 1]} ${best.year}`,
    isFallback: false,
  };
}
