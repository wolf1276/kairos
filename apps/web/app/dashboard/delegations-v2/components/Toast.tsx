"use client";

import { useEffect, useCallback } from "react";

export type ToastKind = "success" | "error" | "info";

export interface ToastData {
  kind: ToastKind;
  title: string;
  message?: string;
}

export function ToastBar({
  toast,
  onDismiss,
}: {
  toast: ToastData | null;
  onDismiss: () => void;
}) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    },
    [onDismiss]
  );

  useEffect(() => {
    if (toast) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [toast, handleEscape]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;

  const colors = {
    success: "border-success/15 bg-success/6 text-success/90",
    error: "border-error/15 bg-error/6 text-error/90",
    info: "border-accent/10 bg-accent-muted/30 text-accent",
  };

  const icons = {
    success: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    error: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
    info: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  };

  return (
    <div className="fixed bottom-6 right-6 z-[60] animate-fade-in-up">
      <div
        className={`flex items-center gap-3 rounded-xl border px-4 py-3 shadow-xl backdrop-blur-md ${colors[toast.kind]}`}
      >
        <span className="shrink-0">{icons[toast.kind]}</span>
        <div>
          <p className="text-xs font-medium">{toast.title}</p>
          {toast.message && <p className="mt-0.5 text-[11px] opacity-80">{toast.message}</p>}
        </div>
        <button
          onClick={onDismiss}
          className="ml-2 shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
