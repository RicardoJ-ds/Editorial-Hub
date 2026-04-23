"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface SummaryCardProps {
  title: string;
  /** Subtle full description shown below the title */
  subtitle?: string;
  value: string | number;
  description?: string;
  valueColor?: "white" | "green" | "red";
  progress?: number;
}

export function SummaryCard({
  title,
  subtitle,
  value,
  description,
  valueColor = "white",
  progress,
}: SummaryCardProps) {
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          {title}
        </p>
        {subtitle && (
          <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">{subtitle}</p>
        )}
        <p
          className={cn(
            "mt-1.5 font-mono text-2xl font-bold",
            valueColor === "green" && "text-[#42CA80]",
            valueColor === "red" && "text-[#ED6958]",
            valueColor === "white" && "text-white"
          )}
        >
          {value}
        </p>
        {description && (
          <p className="mt-1 text-xs text-[#C4BCAA]">{description}</p>
        )}
        {progress !== undefined && (
          <div className="mt-2">
            <Progress value={progress} className="h-1" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
