"use client";

interface ProgressArcProps {
  value: number;
  max: number;
  label: string;
  size?: number;
}

// Stops for the cream-to-green progression. Pulled from
// `PIPELINE_STAGE_COLORS` in shared-helpers (WN1 → P1 → P2 → P3) so the
// gauges visually rhyme with the Cumulative Pipeline cards.
const ARC_STOPS = [
  { pct: 0, color: [0xdd, 0xcf, 0xac] }, // WN1 cream
  { pct: 33, color: [0x65, 0xff, 0xaa] }, // P1 bright green
  { pct: 66, color: [0x42, 0xca, 0x80] }, // P2 standard green
  { pct: 100, color: [0x2e, 0x8c, 0x59] }, // P3 deep green
];

function arcColor(pct: number): string {
  if (pct <= 0) return rgbToHex(ARC_STOPS[0].color);
  if (pct >= 100) return rgbToHex(ARC_STOPS[ARC_STOPS.length - 1].color);
  for (let i = 0; i < ARC_STOPS.length - 1; i++) {
    const a = ARC_STOPS[i];
    const b = ARC_STOPS[i + 1];
    if (pct >= a.pct && pct <= b.pct) {
      const t = (pct - a.pct) / (b.pct - a.pct);
      const rgb = [0, 1, 2].map(
        (j) => Math.round(a.color[j] + (b.color[j] - a.color[j]) * t),
      );
      return rgbToHex(rgb);
    }
  }
  return rgbToHex(ARC_STOPS[ARC_STOPS.length - 1].color);
}

function rgbToHex([r, g, b]: number[]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Semicircular progress gauge.
 *
 *   • Inside the arc: the percentage (always 3 chars max — "99%" / "100%").
 *   • Below the arc: the `value / max` ratio + label, in small text.
 *
 * Previously the ratio rendered inside the arc; with three-digit numerators
 * ("317/381") that overflowed the 72px arc width.
 */
export function ProgressArc({ value, max, label, size = 80 }: ProgressArcProps) {
  // True percentage (uncapped) for the displayed number — over-delivery
  // against a goal IS meaningful (110% reads as "exceeded by 10%").
  // The arc fill itself stays capped at 100% so it doesn't visually
  // overflow the semicircle.
  const pctRaw = max > 0 ? (value / max) * 100 : 0;
  const pctRounded = Math.round(pctRaw);
  const arcPct = Math.min(pctRaw, 100);
  // Cream-to-green gradient inspired by the Cumulative Pipeline stage
  // colors (WN1 cream → P1 → P2 → P3). Low completion reads as a soft
  // light tone; high completion lands on deep Graphite green. No red /
  // amber — these gauges express progress, not health risk.
  const color = arcColor(pctRaw);

  const r = (size - 10) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = Math.PI * r;
  const offset = circumference - (arcPct / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg
        width={size}
        height={size / 2 + 10}
        viewBox={`0 0 ${size} ${size / 2 + 10}`}
      >
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="#2a2a2a"
          strokeWidth={6}
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          className="font-mono tabular-nums"
          style={{ fontSize: 17, fill: color, fontWeight: 700 }}
        >
          {max > 0 ? `${pctRounded}%` : "—"}
        </text>
      </svg>
      <span className="font-mono text-[11px] tabular-nums text-white">
        {value.toLocaleString()}
        <span className="text-[#606060]"> / </span>
        {max.toLocaleString()}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-[#909090]">
        {label}
      </span>
    </div>
  );
}
