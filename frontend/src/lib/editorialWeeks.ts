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

function priorMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

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

  const todayMs = now.getTime();
  // Latest Week 1 whose start is on or before today.
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
    // Today is before every Week 1 we know — early in a fresh year before
    // the team has added the new "<YYYY> Week Distribution" tab.
    return calendarFallback(now);
  }

  // Last week of the candidate Editorial month, used to decide whether
  // today still sits inside it or has rolled past.
  let lastWeekEnd: number | null = null;
  for (const w of weeks) {
    if (w.year !== current.year || w.month !== current.month) continue;
    const endMs = isoToLocalDate(w.end).getTime();
    if (lastWeekEnd === null || endMs > lastWeekEnd) lastWeekEnd = endMs;
  }

  if (lastWeekEnd !== null && todayMs <= lastWeekEnd) {
    // Today sits inside a known week of the current Editorial month — the
    // common path. Last completed is the prior Editorial month.
    const lc = priorMonth(current.year, current.month);
    return {
      label: `${MONTH_NAMES_LONG[lc.month - 1]} ${lc.year}`,
      isFallback: false,
    };
  }

  // Today is past every known week of the current Editorial month. If we
  // know next month's Week 1, today must be inside it — so "last completed"
  // is the current month. Otherwise we don't know where today landed; fall
  // back to calendar with the indicator.
  let nextYear = current.year;
  let nextMonth = current.month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const hasNext = weeks.some(
    (w) => w.year === nextYear && w.month === nextMonth && w.weekNumber === 1,
  );
  if (hasNext) {
    return {
      label: `${MONTH_NAMES_LONG[current.month - 1]} ${current.year}`,
      isFallback: false,
    };
  }

  return calendarFallback(now);
}
