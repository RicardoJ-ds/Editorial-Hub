"use client";

import { useEffect, useState } from "react";
import { Eye, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  consumePreviewReturnPath,
  setPreviewAs,
  useAccessProfile,
} from "@/lib/accessClient";

/**
 * Sticky global banner shown whenever the admin is impersonating another
 * user via Preview Access. Mounted in the app layout so it's visible on
 * every page — including a previewed user's first accessible page or
 * the No Access fallback when they have no usable views. Clicking
 * Exit Preview returns the admin to the path they were on when entering
 * preview (saved via `setPreviewAs(email, pathname)`).
 *
 * The `mounted` guard ensures the first client render matches the
 * server's empty output. Without it, dev fast-refresh can carry the
 * cached profile across re-mounts and trigger a hydration mismatch.
 */
export function PreviewBanner() {
  const profile = useAccessProfile();
  const router = useRouter();
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
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-[#F5BC4E]/40 bg-[#F5BC4E]/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-[#F5BC4E]">
      <span className="inline-flex items-center gap-2">
        <Eye className="h-3.5 w-3.5" /> Previewing as <b>{profile.email}</b>
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto py-1 text-[11px] uppercase tracking-wider text-[#F5BC4E] hover:bg-[#F5BC4E]/15"
        onClick={() => void exit()}
      >
        <X className="mr-1 h-3 w-3" /> Exit preview
      </Button>
    </div>
  );
}
