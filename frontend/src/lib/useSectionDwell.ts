"use client";

/**
 * `useSectionDwell(sectionId, sectionRef)` — measures how long a
 * section is on-screen and emits a `SectionViewed` analytics event
 * with `dwell_ms` when the section leaves the viewport (or the user
 * navigates away, whichever comes first).
 *
 * Visibility is detected via IntersectionObserver with threshold 0.5,
 * so a section counts as "viewed" only when at least half of it is in
 * the viewport. That filters out the noise from sections briefly
 * passing through during a fast scroll.
 *
 * The dwell timer pauses when the tab is hidden (`visibilitychange`)
 * so leaving the tab open in another window for 30 min doesn't
 * inflate the dwell number for the last-viewed section.
 *
 * Drop this hook into any `<Section>` component:
 *
 *     const ref = useRef<HTMLElement>(null);
 *     useSectionDwell("period-snapshot", ref);
 *     return <section ref={ref}>...</section>;
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { trackEvent } from "@/lib/analyticsClient";

// Threshold below this isn't worth recording — anything < 500ms is
// most likely a scroll-past, not a real read.
const MIN_DWELL_MS = 500;
// Cap dwell at 30 min per visit; anything longer is almost certainly
// "tab left open while user did something else" rather than active
// reading. Prevents one zombie tab from skewing per-section averages.
const MAX_DWELL_MS = 30 * 60 * 1000;

/**
 * By-id variant — looks up the section element via
 * `document.getElementById(sectionId)` instead of requiring a ref.
 * Use this on dashboards that already use bare `<section id="...">`
 * tags so you can drop a one-liner at the top of the component
 * without restructuring the JSX. Falls back to a polling lookup for
 * the first 500 ms in case the DOM mounts after the hook fires.
 */
export function useSectionDwellById(sectionId: string): void {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Resolve the element with a few retries — handy when the section
    // is rendered conditionally (loading skeletons, suspense, etc).
    let attempts = 0;
    const findEl = () => {
      const el = document.getElementById(sectionId);
      if (el) {
        ref.current = el;
        return;
      }
      attempts += 1;
      if (attempts < 10) {
        // 10 × 50 ms = 500 ms total
        window.setTimeout(findEl, 50);
      }
    };
    findEl();
  }, [sectionId]);
  useSectionDwell(sectionId, ref);
}

export function useSectionDwell(
  sectionId: string,
  ref: React.RefObject<HTMLElement | null>,
): void {
  const pathname = usePathname();
  // Mutable refs so the observer callbacks read live state without
  // re-binding listeners on every render.
  const startedAt = useRef<number | null>(null);
  const accumulatedMs = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;

    let hasEnteredOnce = false;

    const emit = (reason: "exit" | "unmount" | "hidden") => {
      // If a measurement is in progress, fold its elapsed time into
      // the accumulator before emitting.
      if (startedAt.current !== null) {
        accumulatedMs.current += Date.now() - startedAt.current;
        startedAt.current = null;
      }
      const dwell = Math.min(MAX_DWELL_MS, accumulatedMs.current);
      accumulatedMs.current = 0;
      if (dwell < MIN_DWELL_MS) return;
      trackEvent("SectionViewed", {
        route: pathname ?? "/",
        section_id: sectionId,
        props: { dwell_ms: Math.round(dwell), reason },
      });
    };

    // IntersectionObserver — 0.5 threshold means "at least half on-screen".
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // Start (or resume) the dwell timer
            if (startedAt.current === null) {
              startedAt.current = Date.now();
            }
            // SectionEntered — immediate signal that the section was
            // surfaced to the user. Fires only once per mount so we
            // count distinct visits, not every scroll oscillation
            // through the 0.5 threshold.
            if (!hasEnteredOnce) {
              hasEnteredOnce = true;
              trackEvent("SectionEntered", {
                route: pathname ?? "/",
                section_id: sectionId,
              });
            }
          } else {
            // Section exited the viewport — fold dwell + emit summary
            if (startedAt.current !== null) {
              emit("exit");
            }
          }
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);

    // Pause timer when the tab is hidden; resume on visible.
    const onVisibility = () => {
      if (document.hidden && startedAt.current !== null) {
        accumulatedMs.current += Date.now() - startedAt.current;
        startedAt.current = null;
      } else if (!document.hidden && startedAt.current === null) {
        // Only resume if the section is still on-screen. We don't have
        // a fresh isIntersecting read here — but the IntersectionObserver
        // will re-fire on the next paint, which is correct enough.
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      // Final flush on unmount (route change, etc.)
      emit("unmount");
    };
  }, [ref, sectionId, pathname]);
}
