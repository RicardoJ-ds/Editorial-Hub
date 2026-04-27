"use client";

import { ProposalBanner } from "./_ProposalBanner";
import { SubNav } from "./_SubNav";

/**
 * Sticky wrapper that keeps the ProposalBanner (yellow card), MonthPicker, and
 * GlobalSearch pinned just below the app Header while the page body scrolls.
 *
 * Top offset = 56px app header (h-14). Z-index sits below the app sidebar (z-40)
 * so the expanded sidebar still overlays this chrome when the user hovers it.
 */
export function StickyPageChrome({ subtitle }: { subtitle?: string }) {
  return (
    <div className="sticky top-10 z-20 flex flex-col gap-3 bg-black pb-3">
      <ProposalBanner subtitle={subtitle} />
      <SubNav />
    </div>
  );
}
