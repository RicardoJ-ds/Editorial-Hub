"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { apiPost, apiPut } from "@/lib/api";
import type { Client, ClientCreate } from "@/lib/types";

interface ClientFormProps {
  client?: Client;
  open: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "SOON_TO_BE_ACTIVE", label: "Soon to be Active" },
];

const POD_OPTIONS = [
  { value: "Pod 1", label: "Pod 1" },
  { value: "Pod 2", label: "Pod 2" },
  { value: "Pod 3", label: "Pod 3" },
  { value: "Pod 4", label: "Pod 4" },
  { value: "Pod 5", label: "Pod 5" },
];

const PROJECT_TYPE_OPTIONS = [
  { value: "Full + Writing", label: "Full + Writing" },
  { value: "Content + Writing", label: "Content + Writing" },
  { value: "Full", label: "Full" },
];

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-2">
      <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-graphite-green">
        {children}
      </h3>
      <Separator className="mt-2" />
    </div>
  );
}

export function ClientForm({
  client,
  open,
  onSuccess,
  onClose,
}: ClientFormProps) {
  const isEdit = !!client;

  const [formData, setFormData] = useState<ClientCreate>({
    name: client?.name ?? "",
    domain: client?.domain ?? "",
    status: client?.status ?? "ACTIVE",
    start_date: client?.start_date ?? "",
    end_date: client?.end_date ?? "",
    term_months: client?.term_months ?? undefined,
    articles_sow: client?.articles_sow ?? undefined,
    cadence: client?.cadence ?? "",
    word_count_min: client?.word_count_min ?? undefined,
    word_count_max: client?.word_count_max ?? undefined,
    sow_link: client?.sow_link ?? "",
    editorial_pod: client?.editorial_pod ?? "",
    growth_pod: client?.growth_pod ?? "",
    project_type: client?.project_type ?? "",
    managing_director: client?.managing_director ?? "",
    account_director: client?.account_director ?? "",
    account_manager: client?.account_manager ?? "",
    consulting_ko_date: client?.consulting_ko_date ?? "",
    editorial_ko_date: client?.editorial_ko_date ?? "",
    first_cb_approved_date: client?.first_cb_approved_date ?? "",
    first_article_delivered_date: client?.first_article_delivered_date ?? "",
    first_feedback_date: client?.first_feedback_date ?? "",
    first_article_published_date: client?.first_article_published_date ?? "",
    comments: client?.comments ?? "",
  });

  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  function updateField(field: keyof ClientCreate, value: string | number | undefined) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(formData)) {
      if (value !== "" && value !== undefined && value !== null) {
        payload[key] = value;
      }
    }
    return payload;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.name.trim()) {
      setFeedback({ type: "error", message: "Client name is required." });
      return;
    }

    setLoading(true);
    setFeedback(null);

    try {
      const payload = buildPayload();
      if (isEdit && client) {
        await apiPut(`/api/clients/${client.id}`, payload);
        setFeedback({ type: "success", message: "Client updated successfully." });
      } else {
        await apiPost("/api/clients/", payload);
        setFeedback({ type: "success", message: "Client created successfully." });
      }
      setTimeout(() => {
        onSuccess();
      }, 600);
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "An error occurred.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit Client" : "Add Client"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Update the client details below."
              : "Fill in the details to create a new client."}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-140px)] pr-1">
          <form onSubmit={handleSubmit} className="space-y-4 px-4 pb-6">
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

            {/* Basic Info */}
            <SectionHeader>Basic Info</SectionHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="font-mono text-xs">
                  Name *
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="Client name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="domain" className="font-mono text-xs">
                  Domain
                </Label>
                <Input
                  id="domain"
                  value={formData.domain ?? ""}
                  onChange={(e) => updateField("domain", e.target.value)}
                  placeholder="example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="font-mono text-xs">Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(val) => updateField("status", val ?? "ACTIVE")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* SOW Details */}
            <SectionHeader>SOW Details</SectionHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="start_date" className="font-mono text-xs">
                    Start Date
                  </Label>
                  <Input
                    id="start_date"
                    type="date"
                    value={formData.start_date ?? ""}
                    onChange={(e) => updateField("start_date", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end_date" className="font-mono text-xs">
                    End Date
                  </Label>
                  <Input
                    id="end_date"
                    type="date"
                    value={formData.end_date ?? ""}
                    onChange={(e) => updateField("end_date", e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="term_months" className="font-mono text-xs">
                    Term (Months)
                  </Label>
                  <Input
                    id="term_months"
                    type="number"
                    value={formData.term_months ?? ""}
                    onChange={(e) =>
                      updateField(
                        "term_months",
                        e.target.value ? Number(e.target.value) : undefined
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="articles_sow" className="font-mono text-xs">
                    Articles SOW
                  </Label>
                  <Input
                    id="articles_sow"
                    type="number"
                    value={formData.articles_sow ?? ""}
                    onChange={(e) =>
                      updateField(
                        "articles_sow",
                        e.target.value ? Number(e.target.value) : undefined
                      )
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cadence" className="font-mono text-xs">
                  Cadence
                </Label>
                <Input
                  id="cadence"
                  value={formData.cadence ?? ""}
                  onChange={(e) => updateField("cadence", e.target.value)}
                  placeholder="e.g. 4/month"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="word_count_min" className="font-mono text-xs">
                    Word Count Min
                  </Label>
                  <Input
                    id="word_count_min"
                    type="number"
                    value={formData.word_count_min ?? ""}
                    onChange={(e) =>
                      updateField(
                        "word_count_min",
                        e.target.value ? Number(e.target.value) : undefined
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="word_count_max" className="font-mono text-xs">
                    Word Count Max
                  </Label>
                  <Input
                    id="word_count_max"
                    type="number"
                    value={formData.word_count_max ?? ""}
                    onChange={(e) =>
                      updateField(
                        "word_count_max",
                        e.target.value ? Number(e.target.value) : undefined
                      )
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sow_link" className="font-mono text-xs">
                  SOW Link
                </Label>
                <Input
                  id="sow_link"
                  value={formData.sow_link ?? ""}
                  onChange={(e) => updateField("sow_link", e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>

            {/* Team Assignment */}
            <SectionHeader>Team Assignment</SectionHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="font-mono text-xs">Editorial Pod</Label>
                <Select
                  value={formData.editorial_pod || ""}
                  onValueChange={(val) => updateField("editorial_pod", val ?? undefined)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select pod" />
                  </SelectTrigger>
                  <SelectContent>
                    {POD_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="growth_pod" className="font-mono text-xs">
                  Growth Pod
                </Label>
                <Input
                  id="growth_pod"
                  value={formData.growth_pod ?? ""}
                  onChange={(e) => updateField("growth_pod", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="font-mono text-xs">Project Type</Label>
                <Select
                  value={formData.project_type || ""}
                  onValueChange={(val) => updateField("project_type", val ?? undefined)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Account Team */}
            <SectionHeader>Account Team</SectionHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="managing_director" className="font-mono text-xs">
                  Managing Director
                </Label>
                <Input
                  id="managing_director"
                  value={formData.managing_director ?? ""}
                  onChange={(e) =>
                    updateField("managing_director", e.target.value)
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="account_director" className="font-mono text-xs">
                  Account Director
                </Label>
                <Input
                  id="account_director"
                  value={formData.account_director ?? ""}
                  onChange={(e) =>
                    updateField("account_director", e.target.value)
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="account_manager" className="font-mono text-xs">
                  Account Manager
                </Label>
                <Input
                  id="account_manager"
                  value={formData.account_manager ?? ""}
                  onChange={(e) =>
                    updateField("account_manager", e.target.value)
                  }
                />
              </div>
            </div>

            {/* Milestones */}
            <SectionHeader>Milestones</SectionHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs">Consulting KO</Label>
                  <Input
                    type="date"
                    value={formData.consulting_ko_date ?? ""}
                    onChange={(e) =>
                      updateField("consulting_ko_date", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs">Editorial KO</Label>
                  <Input
                    type="date"
                    value={formData.editorial_ko_date ?? ""}
                    onChange={(e) =>
                      updateField("editorial_ko_date", e.target.value)
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs">First CB Approved</Label>
                  <Input
                    type="date"
                    value={formData.first_cb_approved_date ?? ""}
                    onChange={(e) =>
                      updateField("first_cb_approved_date", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs">First Article Delivered</Label>
                  <Input
                    type="date"
                    value={formData.first_article_delivered_date ?? ""}
                    onChange={(e) =>
                      updateField(
                        "first_article_delivered_date",
                        e.target.value
                      )
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs">First Feedback</Label>
                  <Input
                    type="date"
                    value={formData.first_feedback_date ?? ""}
                    onChange={(e) =>
                      updateField("first_feedback_date", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs">First Published</Label>
                  <Input
                    type="date"
                    value={formData.first_article_published_date ?? ""}
                    onChange={(e) =>
                      updateField(
                        "first_article_published_date",
                        e.target.value
                      )
                    }
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <SectionHeader>Notes</SectionHeader>
            <div className="space-y-1.5">
              <Label htmlFor="comments" className="font-mono text-xs">
                Comments
              </Label>
              <Textarea
                id="comments"
                value={formData.comments ?? ""}
                onChange={(e) => updateField("comments", e.target.value)}
                placeholder="Additional notes..."
                rows={3}
              />
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-4">
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? "Update Client" : "Create Client"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </Button>
            </div>
          </form>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
