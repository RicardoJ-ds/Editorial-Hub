"use client";

interface ProgressArcProps {
  value: number;
  max: number;
  label: string;
  size?: number;
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
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const pctRounded = Math.round(pct);
  const color = pct >= 75 ? "#42CA80" : pct >= 50 ? "#F5C542" : "#ED6958";

  const r = (size - 10) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;

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
