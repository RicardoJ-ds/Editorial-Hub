"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SectionDef {
  id: string;
  label: string;
}

interface Props {
  sections: SectionDef[];
  /** Pixel offset from the top of the viewport where the sticky filter/tabs
   *  header ends. Click-jumps subtract this so the section title isn't
   *  hidden under the sticky header. Defaults to 180 to clear filters + tabs. */
  topOffset?: number;
}

/** Walk up the DOM and collect every ancestor that's a scroll container. The
 *  page wraps content in a custom scroller (`<main>` inside an `overflow-auto`
 *  flex column), so window.scroll never fires — we have to listen on the
 *  actual scroller. We collect ALL of them so we don't miss the right one
 *  if the layout changes (and listening to extra scroll events is cheap). */
function findScrollers(el: HTMLElement | null): HTMLElement[] {
  const out: HTMLElement[] = [];
  let cur: HTMLElement | null = el?.parentElement ?? null;
  while (cur) {
    const overflowY = getComputedStyle(cur).overflowY;
    if (/(auto|scroll|overlay)/.test(overflowY)) {
      out.push(cur);
    }
    cur = cur.parentElement;
  }
  return out;
}

/** Closest scroller — first match walking up. Used for click-jump where we
 *  need to call scrollTo on a specific element. */
function findScroller(el: HTMLElement | null): HTMLElement | null {
  return findScrollers(el)[0] ?? null;
}

/**
 * Minimal vertical anchor nav for the current tab's sections. Sticks below
 * the page's filter/tabs header on the left side of the content. Click jumps
 * to the section; an IntersectionObserver keeps the active item in sync as
 * the user scrolls.
 *
 * Renders as a thin column on xl+ screens; hidden on smaller widths so the
 * main content stays unconstrained.
 */
export function SectionIndex({ sections, topOffset = 140 }: Props) {
  const [activeId, setActiveId] = useState<string | null>(
    sections[0]?.id ?? null,
  );
  // Stable ref so the observer effect can depend on the joined ids only —
  // avoids re-creating the observer on every parent re-render.
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ids = sectionsRef.current.map((s) => s.id);
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    // The "active" section = the one whose top is closest to the
    // sticky-header line. Compute from getBoundingClientRect (viewport-
    // relative, so it works regardless of which DOM node scrolls).
    //
    // We allow a small positive tolerance (lookahead) so a section that just
    // barely hasn't reached the line still counts as active. This absorbs:
    //   • smooth-scroll easing landing 1–5px short of the target
    //   • sub-pixel rounding from layout
    //   • the natural "I clicked this section, expect it active" intent
    // The lookahead is roughly the sticky-header height (~50px), so the
    // active section flips right as its sticky title is about to take over
    // the viewport's top band.
    const ACTIVE_LOOKAHEAD = 60;
    const updateActive = () => {
      let best: { id: string; distance: number } | null = null;
      for (const el of elements) {
        const top = el.getBoundingClientRect().top;
        const d = top - topOffset;
        if (d <= ACTIVE_LOOKAHEAD && (!best || d > best.distance)) {
          best = { id: el.id, distance: d };
        }
      }
      // No section in the active band yet → first section is active (top of
      // page, before any section has reached the line).
      if (!best && elements.length > 0) {
        best = { id: elements[0].id, distance: 0 };
      }
      if (best) setActiveId(best.id);
    };

    updateActive();

    // Attach scroll listeners on EVERY scrollable ancestor + window. The
    // page nests an `overflow-auto` content area inside the layout shell,
    // so window may not be the actual scroller. Listening on all of them is
    // cheap and ensures we never miss a scroll event regardless of layout.
    const scrollers = findScrollers(elements[0]);
    const targets: (HTMLElement | Window)[] = [window, ...scrollers];
    for (const t of targets) {
      t.addEventListener("scroll", updateActive, { passive: true });
    }
    window.addEventListener("resize", updateActive);
    return () => {
      for (const t of targets) {
        t.removeEventListener("scroll", updateActive);
      }
      window.removeEventListener("resize", updateActive);
    };
  }, [sections.map((s) => s.id).join("|"), topOffset]);

  const handleJump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    setActiveId(id);

    // Prefer the actual scroll container — `el.scrollIntoView` on a sticky
    // ancestor can jump the wrong surface or ignore the smooth flag.
    const scroller = findScroller(el);
    if (scroller) {
      const rect = el.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const top = rect.top - scrollerRect.top + scroller.scrollTop - topOffset;
      scroller.scrollTo({ top, behavior: "smooth" });
      return;
    }
    // Fallback to window scroll.
    const top = el.getBoundingClientRect().top + window.scrollY - topOffset;
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <nav
      aria-label="Section navigation"
      className="hidden xl:block sticky self-start shrink-0 w-[156px]"
      style={{ top: topOffset + 12 }}
    >
      <p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-[#606060]">
        Sections
      </p>
      <ul className="space-y-px">
        {sections.map((s) => {
          const active = s.id === activeId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => handleJump(s.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "block w-full text-left py-1.5 pl-3 -ml-px border-l-2 font-mono text-[11px] uppercase tracking-wider transition-colors",
                  active
                    ? "border-[#42CA80] text-white"
                    : "border-[#2a2a2a] text-[#606060] hover:text-[#C4BCAA] hover:border-[#404040]",
                )}
              >
                {s.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
