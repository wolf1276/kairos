"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Terminal, Pause, Play, Search, Copy, Check,
  BrainCircuit, ShieldCheck, Zap, TrendingUp, Database, GraduationCap, AlertTriangle, Radio,
} from "lucide-react";
import { getAuditLog, type AuditLogRow, type AuditEventType, type AgentSummary } from "@/app/lib/agentsBackend";

/** The signature element of the redesign — a live, terminal-style console over the *real*
 *  global audit log (`GET /api/audit`), not a fabricated event stream. Polls on an interval and
 *  diffs by id so entries animate in once, oldest-safe (dedupes across polls). */

const EVENT_GROUP: Record<AuditEventType, { label: string; icon: typeof Terminal; tone: string }> = {
  strategy_started: { label: "PIPELINE", icon: Zap, tone: "text-accent" },
  strategy_stopped: { label: "PIPELINE", icon: Zap, tone: "text-text-muted" },
  strategy_error: { label: "ERROR", icon: AlertTriangle, tone: "text-error" },
  signal_generated: { label: "REASONING", icon: BrainCircuit, tone: "text-indigo-400" },
  policy_violation: { label: "VERIFY", icon: ShieldCheck, tone: "text-amber-400" },
  delegation_invalid: { label: "VERIFY", icon: ShieldCheck, tone: "text-error" },
  trade_executed: { label: "EXECUTION", icon: TrendingUp, tone: "text-success" },
  position_updated: { label: "MEMORY", icon: Database, tone: "text-accent" },
  agent_provisioned: { label: "SYSTEM", icon: Radio, tone: "text-text-secondary" },
  market_analysis: { label: "CONTEXT", icon: Radio, tone: "text-text-secondary" },
  decision_made: { label: "REASONING", icon: BrainCircuit, tone: "text-indigo-400" },
  strategy_selected: { label: "PLANNING", icon: Zap, tone: "text-accent" },
  yield_opportunity: { label: "LEARNING", icon: GraduationCap, tone: "text-success" },
  portfolio_rebalanced: { label: "LEARNING", icon: GraduationCap, tone: "text-success" },
} as unknown as Record<AuditEventType, { label: string; icon: typeof Terminal; tone: string }>;

function eventMeta(type: AuditEventType) {
  return EVENT_GROUP[type] ?? { label: type.toUpperCase(), icon: Radio, tone: "text-text-secondary" };
}

function fmtClock(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false });
}

export function LiveOperationsTerminal({ agents }: { agents: AgentSummary[] }) {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (paused) return;
      try {
        const events = await getAuditLog({ limit: 60 });
        if (cancelled) return;
        setConnected(true);
        setRows((prev) => {
          const merged = [...events].reverse().concat(prev);
          const dedup: AuditLogRow[] = [];
          const seenIds = new Set<string>();
          for (const r of merged) {
            if (seenIds.has(r.id)) continue;
            seenIds.add(r.id);
            dedup.push(r);
          }
          dedup.sort((a, b) => a.created_at - b.created_at);
          events.forEach((e) => seen.current.add(e.id));
          return dedup.slice(-300);
        });
      } catch {
        if (!cancelled) setConnected(false);
      }
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [paused]);

  useEffect(() => {
    if (paused) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows, paused]);

  const agentByKey = useMemo(() => {
    const m = new Map<string, string>();
    agents.forEach((a) => m.set(a.id, a.publicKey.slice(0, 6)));
    return m;
  }, [agents]);

  const eventTypes = useMemo(() => Array.from(new Set(rows.map((r) => r.event_type))), [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterType !== "all" && r.event_type !== filterType) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        r.event_type.toLowerCase().includes(q) ||
        r.pair?.toLowerCase().includes(q) ||
        r.message?.toLowerCase().includes(q) ||
        r.agent_id.toLowerCase().includes(q)
      );
    });
  }, [rows, filterType, query]);

  const copyRow = async (r: AuditLogRow) => {
    await navigator.clipboard.writeText(JSON.stringify(r, null, 2));
    setCopiedId(r.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Terminal className="h-4 w-4 text-accent" />
          <h3 className="font-display text-sm font-medium text-text-primary">Live Operations Terminal</h3>
          <span className={cn("flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider",
            connected ? "border-success/15 bg-success/8 text-success/90" : "border-error/15 bg-error/8 text-error/90")}>
            <span className={cn("h-1.5 w-1.5 rounded-full bg-current", connected && !paused && "animate-pulse")} />
            {connected ? (paused ? "Paused" : "Live") : "Reconnecting"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stream…"
              className="w-40 rounded-lg border border-white/5 bg-bg-elevated py-1.5 pl-7 pr-2.5 font-mono text-[11px] text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 sm:w-56"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-lg border border-white/5 bg-bg-elevated px-2.5 py-1.5 font-mono text-[11px] text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          >
            <option value="all">All events</option>
            {eventTypes.map((t) => (
              <option key={t} value={t}>{eventMeta(t).label.toLowerCase()} · {t}</option>
            ))}
          </select>
          <button
            onClick={() => setPaused((p) => !p)}
            className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="max-h-96 overflow-y-auto px-5 py-3 font-mono text-[11px] leading-relaxed"
      >
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-text-muted">No operations recorded yet — events will stream here as agents run.</p>
        ) : (
          filtered.map((r) => {
            const meta = eventMeta(r.event_type);
            const Icon = meta.icon;
            return (
              <div
                key={r.id}
                className="group flex items-start gap-3 border-b border-white/[0.03] py-1.5 last:border-0 animate-[fadeIn_0.3s_ease]"
              >
                <span className="w-[70px] shrink-0 text-text-muted">{fmtClock(r.created_at)}</span>
                <Icon className={cn("mt-0.5 h-3 w-3 shrink-0", meta.tone)} />
                <span className={cn("w-24 shrink-0 uppercase tracking-wider", meta.tone)}>{meta.label}</span>
                {agentByKey.get(r.agent_id) && (
                  <span className="shrink-0 rounded border border-white/5 bg-white/[0.02] px-1.5 py-0 text-[10px] text-text-secondary">
                    {agentByKey.get(r.agent_id)}
                  </span>
                )}
                {r.pair && <span className="shrink-0 text-text-secondary">{r.pair}</span>}
                <span className="min-w-0 flex-1 truncate text-text-secondary">
                  {r.message || r.signal || r.execution_status || r.event_type}
                </span>
                <button
                  onClick={() => copyRow(r)}
                  className="shrink-0 text-text-muted opacity-0 transition-opacity hover:text-text-primary group-hover:opacity-100"
                  title="Copy event JSON"
                >
                  {copiedId === r.id ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
