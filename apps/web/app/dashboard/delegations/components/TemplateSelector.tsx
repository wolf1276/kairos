"use client";

import { DELEGATION_TEMPLATES, type DelegationTemplate } from "../types/delegation";

const RISK_COLORS: Record<string, string> = {
  low: "text-success bg-success/8 border-success/15",
  moderate: "text-amber-400 bg-amber-400/8 border-amber-400/15",
  high: "text-error bg-error/8 border-error/15",
};

export function TemplateSelector({
  onSelect,
  onSkip,
}: {
  onSelect: (template: DelegationTemplate) => void;
  onSkip: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-text-muted">
          Pick a preset template to get started quickly, or configure from scratch.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {DELEGATION_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            className="group rounded-xl border border-white/5 bg-white/[0.02] p-4 text-left transition-all duration-200 hover:border-accent/20 hover:bg-accent-muted/20 cursor-pointer"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-text-primary">{t.name}</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider ${RISK_COLORS[t.risk]}`}
              >
                {t.risk}
              </span>
            </div>
            <p className="text-[11px] text-text-muted leading-snug">{t.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {t.policies.map((p, i) => (
                <span
                  key={i}
                  className="rounded-full border border-white/5 bg-white/[0.02] px-2 py-0.5 text-[9px] text-text-muted"
                >
                  {p.label}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-white/5" />
        <button
          onClick={onSkip}
          className="text-[11px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
        >
          Configure manually
        </button>
        <div className="h-px flex-1 bg-white/5" />
      </div>
    </div>
  );
}
