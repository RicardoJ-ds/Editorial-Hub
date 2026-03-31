"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import type { TeamMember, KpiScoreCreate } from "@/lib/types";

const SENIOR_EDITOR_KPIS = [
  { type: "internal_quality", label: "Internal Quality", target: 95 },
  { type: "external_quality", label: "External Quality", target: 90 },
  { type: "revision_rate", label: "Revision Rate", target: 10 },
  { type: "capacity_utilization", label: "Capacity Utilization", target: 85 },
  { type: "second_reviews", label: "Second Reviews", target: 100 },
  { type: "turnaround_time", label: "Turnaround Time", target: 100 },
  { type: "ai_compliance", label: "AI Compliance", target: 100 },
  { type: "mentorship", label: "Mentorship", target: 100 },
];

const EDITOR_KPIS = [
  { type: "internal_quality", label: "Internal Quality", target: 95 },
  { type: "external_quality", label: "External Quality", target: 90 },
  { type: "revision_rate", label: "Revision Rate", target: 10 },
  { type: "capacity_utilization", label: "Capacity Utilization", target: 85 },
  { type: "turnaround_time", label: "Turnaround Time", target: 100 },
  { type: "ai_compliance", label: "AI Compliance", target: 100 },
  { type: "feedback_adoption", label: "Feedback Adoption", target: 100 },
];

const POD_OPTIONS = ["Pod 1", "Pod 2", "Pod 3", "Pod 4", "Pod 5"];
const MONTH_OPTIONS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

interface KpiRow {
  kpi_type: string;
  label: string;
  score: string;
  target: string;
  notes: string;
}

export default function KpiEntryPage() {
  const [year, setYear] = useState("2026");
  const [month, setMonth] = useState("3");
  const [pod, setPod] = useState("");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [kpiRows, setKpiRows] = useState<KpiRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const fetchTeamMembers = useCallback(async (selectedPod: string) => {
    if (!selectedPod) {
      setTeamMembers([]);
      return;
    }
    setLoading(true);
    try {
      const data = await apiGet<TeamMember[]>(
        `/api/team-members/?pod=${encodeURIComponent(selectedPod)}&is_active=true&limit=200`
      );
      setTeamMembers(data);
    } catch {
      setTeamMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelectedMemberId("");
    setSelectedMember(null);
    setKpiRows([]);
    if (pod) {
      fetchTeamMembers(pod);
    } else {
      setTeamMembers([]);
    }
  }, [pod, fetchTeamMembers]);

  useEffect(() => {
    if (!selectedMemberId) {
      setSelectedMember(null);
      setKpiRows([]);
      return;
    }
    const member = teamMembers.find((m) => String(m.id) === selectedMemberId);
    setSelectedMember(member ?? null);
    if (member) {
      const isSenior = member.role.toLowerCase().includes("senior");
      const kpiDefs = isSenior ? SENIOR_EDITOR_KPIS : EDITOR_KPIS;
      setKpiRows(
        kpiDefs.map((k) => ({
          kpi_type: k.type,
          label: k.label,
          score: "",
          target: String(k.target),
          notes: "",
        }))
      );
    }
  }, [selectedMemberId, teamMembers]);

  function updateKpiRow(index: number, field: keyof KpiRow, value: string) {
    setKpiRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  async function handleSubmit() {
    if (!selectedMemberId || !year || !month) return;

    const payloads: KpiScoreCreate[] = kpiRows
      .filter((row) => row.score !== "")
      .map((row) => ({
        team_member_id: Number(selectedMemberId),
        year: Number(year),
        month: Number(month),
        kpi_type: row.kpi_type,
        score: Number(row.score),
        target: row.target ? Number(row.target) : undefined,
        notes: row.notes || undefined,
      }));

    if (payloads.length === 0) {
      setFeedback({ type: "error", message: "Please enter at least one score." });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    try {
      await apiPost("/api/kpis/bulk", payloads);
      setFeedback({
        type: "success",
        message: `Successfully saved ${payloads.length} KPI scores.`,
      });
      // Reset scores after successful submit
      setKpiRows((prev) =>
        prev.map((row) => ({ ...row, score: "", notes: "" }))
      );
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save KPIs.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">KPI Scorecard</h2>
        <p className="mt-1 text-muted-foreground">
          Enter monthly KPI scores for team members.
        </p>
      </div>

      {feedback && (
        <Alert variant={feedback.type === "error" ? "destructive" : "default"}>
          {feedback.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 text-graphite-green" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <AlertTitle>
            {feedback.type === "success" ? "Success" : "Error"}
          </AlertTitle>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}

      {/* Step 1: Select Period */}
      <div className="rounded-lg border border-border bg-[#161616] p-4">
        <h3 className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-graphite-green">
          Step 1: Select Period
        </h3>
        <div className="flex gap-4">
          <div className="space-y-1.5">
            <Label className="font-mono text-xs">Year</Label>
            <Input
              type="number"
              className="w-28"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="font-mono text-xs">Month</Label>
            <Select value={month} onValueChange={(v) => setMonth(v ?? "")}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Step 2: Select Pod */}
      <div className="rounded-lg border border-border bg-[#161616] p-4">
        <h3 className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-graphite-green">
          Step 2: Select Pod
        </h3>
        <div className="space-y-1.5">
          <Label className="font-mono text-xs">Pod</Label>
          <Select value={pod} onValueChange={(v) => setPod(v ?? "")}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Choose pod..." />
            </SelectTrigger>
            <SelectContent>
              {POD_OPTIONS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Step 3: Select Team Member */}
      {pod && (
        <div className="rounded-lg border border-border bg-[#161616] p-4">
          <h3 className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-graphite-green">
            Step 3: Select Team Member
          </h3>
          {loading ? (
            <Skeleton className="h-8 w-56" />
          ) : teamMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active team members found in {pod}.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label className="font-mono text-xs">Team Member</Label>
              <Select
                value={selectedMemberId}
                onValueChange={(v) => setSelectedMemberId(v ?? "")}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Choose member..." />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name} ({m.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* KPI Entry Form */}
      {selectedMember && kpiRows.length > 0 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-[#161616]">
            <div className="border-b border-border p-4">
              <h3 className="font-mono text-sm font-semibold text-foreground">
                KPI Scores for {selectedMember.name}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Role: {selectedMember.role}
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="font-mono text-xs">KPI</TableHead>
                  <TableHead className="font-mono text-xs w-28">Score</TableHead>
                  <TableHead className="font-mono text-xs w-28">Target</TableHead>
                  <TableHead className="font-mono text-xs">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kpiRows.map((row, index) => (
                  <TableRow key={row.kpi_type} className="border-border">
                    <TableCell className="font-mono text-xs font-medium">
                      {row.label}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.1"
                        className="h-7 w-24 font-mono text-xs"
                        value={row.score}
                        onChange={(e) =>
                          updateKpiRow(index, "score", e.target.value)
                        }
                        placeholder="0"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.1"
                        className="h-7 w-24 font-mono text-xs"
                        value={row.target}
                        onChange={(e) =>
                          updateKpiRow(index, "target", e.target.value)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-7 font-mono text-xs"
                        value={row.notes}
                        onChange={(e) =>
                          updateKpiRow(index, "notes", e.target.value)
                        }
                        placeholder="Optional notes..."
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full sm:w-auto"
          >
            {submitting && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Submit KPI Scores
          </Button>
        </div>
      )}
    </div>
  );
}
