import type { PodBoard, ClientChip } from "./_mock";
import { computeMemberEffective, computePodTotals } from "./_mock";

export type ValidationLevel = "error" | "warning";

export type ValidationIssue = {
  level: ValidationLevel;
  code:
    | "pod_over_capacity"
    | "member_over_allocated"
    | "client_unallocated"
    | "leave_without_backup";
  message: string;
  subject?: string;
};

/**
 * Compute all validation issues for a given month.
 * Pure function — takes the shape the store keeps for a month and returns
 * a list of issues. Rendered by `_ValidationBanner.tsx`.
 */
export function computeMonthIssues(
  pods: PodBoard[],
  unassigned: ClientChip[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Pod over-capacity: projected use > effective capacity.
  for (const pod of pods) {
    const totals = computePodTotals(pod);
    if (totals.projectedUse > totals.totalCapacity && totals.totalCapacity > 0) {
      const pct = Math.round((totals.projectedUse / totals.totalCapacity) * 100);
      issues.push({
        level: "error",
        code: "pod_over_capacity",
        subject: pod.displayName,
        message: `${pod.displayName} is ${pct}% utilized — projected ${totals.projectedUse} vs capacity ${totals.totalCapacity.toFixed(1)}.`,
      });
    }
  }

  // Member over-allocated: sum of capacity_share across pods for the same
  // person > 1.0. In the mock shape we identify members by id across pods.
  const memberShareById = new Map<number, { name: string; share: number }>();
  for (const pod of pods) {
    for (const m of pod.members) {
      const prev = memberShareById.get(m.id);
      if (prev) {
        prev.share += m.capacityShare;
      } else {
        memberShareById.set(m.id, { name: m.fullName, share: m.capacityShare });
      }
    }
  }
  for (const { name, share } of memberShareById.values()) {
    // Tiny float tolerance — treat 1.00x as fine.
    if (share > 1.001) {
      issues.push({
        level: "error",
        code: "member_over_allocated",
        subject: name,
        message: `${name} is allocated at ${(share * 100).toFixed(0)}% across pods (>100%).`,
      });
    }
  }

  // Client unallocated: anything in the unassigned tray.
  for (const c of unassigned) {
    issues.push({
      level: "warning",
      code: "client_unallocated",
      subject: c.name,
      message: `${c.name} has no pod assigned this month (${c.projectedArticles} projected articles).`,
    });
  }

  // Leave > 0.5 without a same-role backup on the pod.
  for (const pod of pods) {
    for (const m of pod.members) {
      if (m.leaveShare <= 0.5) continue;
      const sameRoleBackup = pod.members.some(
        (o) => o.id !== m.id && o.role === m.role && computeMemberEffective(o) > 0,
      );
      if (!sameRoleBackup) {
        issues.push({
          level: "warning",
          code: "leave_without_backup",
          subject: m.fullName,
          message: `${m.fullName} is on ${Math.round(m.leaveShare * 100)}% leave in ${pod.displayName} with no same-role backup.`,
        });
      }
    }
  }

  return issues;
}

export function issuesByLevel(issues: ValidationIssue[]): {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
} {
  return {
    errors: issues.filter((i) => i.level === "error"),
    warnings: issues.filter((i) => i.level === "warning"),
  };
}
