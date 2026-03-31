"use client";

import { useState } from "react";
import type { EngagementCompliance } from "@/lib/types";

// ---------------------------------------------------------------------------
// Progress Ring (SVG)
// ---------------------------------------------------------------------------

function ProgressRing({
  score,
  total,
}: {
  score: number;
  total: number;
}) {
  const pct = total > 0 ? score / total : 0;
  const radius = 28;
  const stroke = 4;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);

  let color = "#ED6958"; // red < 5
  if (score >= 8) color = "#42CA80"; // green
  else if (score >= 5) color = "#F5BC4E"; // yellow

  return (
    <svg width={72} height={72} className="shrink-0">
      {/* Background ring */}
      <circle
        cx={36}
        cy={36}
        r={radius}
        fill="none"
        stroke="#2a2a2a"
        strokeWidth={stroke}
      />
      {/* Foreground ring */}
      <circle
        cx={36}
        cy={36}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform="rotate(-90 36 36)"
        style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
      {/* Score text */}
      <text
        x="50%"
        y="44%"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-white font-mono text-lg font-bold"
      >
        {score}
      </text>
      <text
        x="50%"
        y="64%"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-[#606060] font-mono text-[9px]"
      >
        /{total}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface EngagementHealthProps {
  compliance: EngagementCompliance;
}

export function EngagementHealth({ compliance }: EngagementHealthProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-4">
      <div className="flex items-center gap-4">
        <ProgressRing
          score={compliance.rules_met}
          total={compliance.rules_total}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">
            {compliance.client_name}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-[#606060]">
            {compliance.rules_met} of {compliance.rules_total} rules met
          </p>
        </div>
      </div>

      {/* Expand / Collapse */}
      {compliance.details && compliance.details.length > 0 && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060] hover:text-[#C4BCAA] transition-colors"
          >
            {expanded ? "Hide Details" : "Show Details"}
          </button>

          {expanded && (
            <ul className="mt-2 space-y-1">
              {compliance.details.map((d) => (
                <li
                  key={d.rule_number}
                  className="flex items-center gap-2 font-mono text-xs"
                >
                  <span
                    className={
                      d.met ? "text-[#42CA80]" : "text-[#ED6958]"
                    }
                  >
                    {d.met ? "\u2713" : "\u2717"}
                  </span>
                  <span className="text-[#C4BCAA] truncate">
                    {d.rule_name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
