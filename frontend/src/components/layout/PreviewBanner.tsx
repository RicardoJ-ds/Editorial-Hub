"use client";

import { useEffect, useState } from "react";
import { Eye, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  consumePreviewReturnPath,
  setPreviewAs,
  useAccessProfile,
} from "@/lib/accessClient";
import { useSidebarExpanded } from "@/lib/sidebarState";

/**
 * Full-width sticky banner pinned to the top of the app shell when an
 * admin is impersonating another user via Preview Access.
 *
 * The banner lives inside the `ml-[64px]` content column, so its left
 * edge already starts at the sidebar's collapsed right edge. When the
 * sidebar hovers open to `w-[240px]`, the banner shifts its margin-left
 * by 176px (240 − 64) and shrinks its width to match — visually the
 * banner's line tracks the sidebar's right edge with the same 200ms
 * transition as the sidebar expansion.
 *
 * The `mounted` guard ensures the first client render matches the
 * server's empty output. Without it, dev fast-refresh can carry the
 * cached profile across re-mounts and trigger a hydration mismatch.
 */
export function PreviewBanner() {
  const profile = useAccessProfile();
  const router = useRouter();
  const sidebarExpanded = useSidebarExpanded();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !profile?.is_preview) return null;

  const exit = async () => {
    const returnPath = consumePreviewReturnPath() ?? "/admin/access";
    await setPreviewAs(null);
    router.push(returnPath);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "sticky top-0 z-50 flex items-center justify-between gap-3 border-b-2 border-[#F5BC4E]/70 bg-[#F5BC4E]/[0.12] px-6 py-2 shadow-lg shadow-[#F5BC4E]/10 backdrop-blur-md",
        "transition-[margin-left,width] duration-200 ease-in-out",
        sidebarExpanded
          ? "ml-[176px] w-[calc(100%-176px)]"
          : "ml-0 w-full",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {/* Pulsing dot — "live mode" indicator. Tells the admin this
            isn't a stale chip: preview is active right now. */}
        <span className="relative inline-flex h-2 w-2 shrink-0">
          <span className="absolute inset-0 animate-ping rounded-full bg-[#F5BC4E] opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#F5BC4E]" />
        </span>
        <Eye className="h-4 w-4 shrink-0 text-[#F5BC4E]" />
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[#F5BC4E] whitespace-nowrap">
          Preview mode
        </p>
        <p
          className="min-w-0 truncate font-mono text-[11px] text-[#C4BCAA]"
          title={profile.email}
        >
          as <b className="text-white">{profile.email}</b>
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 rounded-md border border-[#F5BC4E]/50 bg-[#F5BC4E]/10 px-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#F5BC4E] hover:border-[#F5BC4E] hover:bg-[#F5BC4E]/20"
        onClick={() => void exit()}
      >
        <X className="mr-1 h-3 w-3" /> Exit
      </Button>
    </div>
  );
}
