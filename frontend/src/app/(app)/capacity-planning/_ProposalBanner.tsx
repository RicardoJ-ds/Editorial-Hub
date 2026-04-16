import { Sparkles } from "lucide-react";

export function ProposalBanner({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[#E6B450]/30 bg-[#E6B450]/5 px-4 py-3">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#E6B450]" />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-[#E6B450]">
          Proposal — Capacity Planning v2
        </span>
        <span className="text-xs text-[#C4BCAA]">
          {subtitle ??
            "Read-only prototype backed by mock data. Lives alongside the existing Capacity page — nothing merged yet."}{" "}
          See{" "}
          <code className="rounded bg-[#1a1a1a] px-1 font-mono text-[11px]">
            CAPACITY_PLANNING_V2.md
          </code>{" "}
          for the ERD and rollout plan.
        </span>
      </div>
    </div>
  );
}
