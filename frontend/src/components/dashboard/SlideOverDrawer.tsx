"use client";

// Reusable right-side slide-in panel. Portaled to <body> so it escapes any
// transformed/overflow ancestor stacking context. Closes on overlay click,
// the X button, or Escape. Shared by the Capacity + Monthly Articles tabs to
// surface per-pod detail without leaving the table.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

export function SlideOverDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Panel width in px (clamped to 92vw on small screens). */
  width?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[60] bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed right-0 top-0 z-[61] flex h-full flex-col border-l border-[#2a2a2a] bg-[#0d0d0d] shadow-2xl"
            style={{ width: `min(${width}px, 92vw)` }}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.28 }}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#1f1f1f] bg-[#111111] px-4 py-3">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold uppercase tracking-widest text-[#C4BCAA]">
                  {title}
                </p>
                {subtitle && (
                  <p className="mt-0.5 font-mono text-[11px] leading-snug text-[#606060]">
                    {subtitle}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded p-1 text-[#606060] transition-colors hover:bg-[#1f1f1f] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
