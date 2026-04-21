"use client";

interface PacingBadgeProps {
  status: "AHEAD" | "ON_TRACK" | "BEHIND" | "AT_RISK";
}

const CONFIG: Record<
  PacingBadgeProps["status"],
  { bg: string; text: string; label: string }
> = {
  AHEAD: { bg: "rgba(66,202,128,.12)", text: "#42CA80", label: "Ahead" },
  ON_TRACK: { bg: "#1F1F1F", text: "#C4BCAA", label: "On Track" },
  BEHIND: { bg: "rgba(245,188,78,.12)", text: "#F5BC4E", label: "Behind" },
  AT_RISK: { bg: "rgba(237,105,88,.12)", text: "#ED6958", label: "At Risk" },
};

export function PacingBadge({ status }: PacingBadgeProps) {
  const cfg = CONFIG[status];
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      {cfg.label}
    </span>
  );
}
