"use client";

import type { ActivityEvent } from "../types/delegation";

const EVENT_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  created: {
    label: "Created",
    icon: "check",
    color: "border-success/30 bg-success/8 text-success",
  },
  revoked: {
    label: "Revoked",
    icon: "x",
    color: "border-error/30 bg-error/8 text-error",
  },
  enabled: {
    label: "Enabled",
    icon: "check",
    color: "border-success/30 bg-success/8 text-success",
  },
  executed: {
    label: "Executed",
    icon: "arrow",
    color: "border-accent/30 bg-accent-muted/50 text-accent",
  },
};

function EventIcon({ type }: { type: string }) {
  const cfg = EVENT_CONFIG[type];
  return (
    <div className={`flex h-7 w-7 items-center justify-center rounded-full border ${cfg?.color ?? "border-white/10 bg-bg-elevated text-text-muted"}`}>
      {type === "created" || type === "enabled" ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : type === "revoked" ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      ) : type === "executed" ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      ) : (
        <span className="text-[9px] font-mono font-bold">?</span>
      )}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function ActivityTimeline({
  events,
  onClear,
}: {
  events: ActivityEvent[];
  onClear?: () => void;
}) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-bg-elevated/50">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <p className="text-xs text-text-muted">No activity yet</p>
        <p className="mt-1 text-[10px] text-text-muted/60">
          Create or revoke a delegation to see events here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
          Activity ({events.length})
        </h3>
        {onClear && (
          <button
            onClick={onClear}
            className="text-[11px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-3.5 top-2 bottom-2 w-px bg-white/5" />

        <div className="space-y-4">
          {events.map((event) => {
            const cfg = EVENT_CONFIG[event.type];
            return (
              <div key={event.id} className="relative flex items-start gap-3 animate-fade-in-up">
                <EventIcon type={event.type} />
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text-primary">
                      {cfg?.label ?? event.type}
                    </span>
                    <span className="text-[10px] text-text-muted">{formatTime(event.timestamp)}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-text-muted font-mono truncate">
                    {shortHash(event.delegationHash)}
                    {event.details && <span className="text-text-muted/70"> — {event.details}</span>}
                  </p>
                  {event.txHash && (
                    <p className="mt-0.5 text-[10px] text-text-muted/50 font-mono truncate">
                      tx: {shortHash(event.txHash)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
