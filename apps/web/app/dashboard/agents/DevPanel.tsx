"use client";

// Hidden Developer Mode panel. Server-gated: only ever rendered by page.tsx after a real
// `GET /api/dev/status` call succeeds (backend/src/routes/dev.ts, behind requireAuth+requireDev
// / DEV_ALLOWLIST). Every field shown here is a direct passthrough of whatever the /api/dev/*
// endpoints actually return — nothing is invented client-side.
import { useCallback, useEffect, useRef, useState } from "react";
import { Bug, Play, Pause as PauseIcon, Square, RotateCcw, FlaskConical, Download, Search, Copy, Check } from "lucide-react";
import { Badge } from "@/app/components/ui/Badge";
import {
  getDevRuntime,
  getDevPipeline,
  getDevBenchmark,
  devPaperStart,
  devPaperPause,
  devPaperResume,
  devPaperStop,
  devValidationRun,
  devExportLogsUrl,
  devExportBenchmarkUrl,
  openDevStream,
  type AgentSummary,
  type DevPipelineSnapshot,
  type DevBenchmarkSession,
  type AuditLogRow,
} from "@/app/lib/agentsBackend";

const BTN_CLS =
  "flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40";

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
}

export function DevPanel({ agent }: { agent: AgentSummary }) {
  const [open, setOpen] = useState(false);
  const [runtime, setRuntime] = useState<unknown>(null);
  const [pipeline, setPipeline] = useState<DevPipelineSnapshot | null>(null);
  const [benchmark, setBenchmark] = useState<{ session: DevBenchmarkSession | null; trading: unknown; pipelineLatency: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [terminalRows, setTerminalRows] = useState<AuditLogRow[]>([]);
  const [terminalPaused, setTerminalPaused] = useState(false);
  const [terminalQuery, setTerminalQuery] = useState("");
  const [terminalConnected, setTerminalConnected] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [rt, pl, bm] = await Promise.all([
        getDevRuntime().catch(() => null),
        getDevPipeline().catch(() => null),
        getDevBenchmark().catch(() => null),
      ]);
      setRuntime(rt);
      setPipeline(pl);
      setBenchmark(bm);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const unsubscribe = openDevStream(
      (row) => {
        if (terminalPaused) return;
        setTerminalConnected(true);
        setTerminalRows((prev) => [...prev, row].slice(-300));
      },
      () => setTerminalConnected(false)
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (terminalPaused) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [terminalRows, terminalPaused]);

  const runAction = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyRow = async (r: AuditLogRow) => {
    await navigator.clipboard.writeText(JSON.stringify(r, null, 2));
    setCopiedId(r.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const filteredRows = terminalQuery
    ? terminalRows.filter((r) => JSON.stringify(r).toLowerCase().includes(terminalQuery.toLowerCase()))
    : terminalRows;

  return (
    <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.03]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-400/90">
          <Bug className="h-3.5 w-3.5" /> Developer Controls
        </span>
        <span className="text-[10px] text-text-muted">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-amber-500/10 px-3 py-3">
          {error && (
            <div className="rounded-lg border border-error/15 bg-error/6 px-3 py-2">
              <p className="text-xs text-error/90">{error}</p>
            </div>
          )}

          <section className="space-y-2">
            <h5 className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Paper Trading Controls</h5>
            <div className="flex flex-wrap gap-2">
              <button className={BTN_CLS} disabled={busy} onClick={() => runAction(() => devPaperStart({ agentId: agent.id }))}>
                <Play className="h-3 w-3" /> Start
              </button>
              <button className={BTN_CLS} disabled={busy} onClick={() => runAction(() => devPaperPause(agent.id))}>
                <PauseIcon className="h-3 w-3" /> Pause
              </button>
              <button className={BTN_CLS} disabled={busy} onClick={() => runAction(() => devPaperResume(agent.id))}>
                <RotateCcw className="h-3 w-3" /> Resume
              </button>
              <button className={BTN_CLS} disabled={busy} onClick={() => runAction(() => devPaperStop(agent.id))}>
                <Square className="h-3 w-3" /> Stop
              </button>
              <button className={BTN_CLS} disabled={busy} onClick={() => runAction(() => devValidationRun())}>
                <FlaskConical className="h-3 w-3" /> Run Validation
              </button>
              <a className={BTN_CLS} href={devExportLogsUrl()} target="_blank" rel="noreferrer">
                <Download className="h-3 w-3" /> Export Logs
              </a>
              <a className={BTN_CLS} href={devExportBenchmarkUrl()} target="_blank" rel="noreferrer">
                <Download className="h-3 w-3" /> Export Benchmark
              </a>
            </div>
          </section>

          <section className="space-y-2">
            <h5 className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Live Pipeline (Debug)</h5>
            {!pipeline ? (
              <p className="text-[11px] text-text-muted">No pipeline run recorded in this process yet.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {pipeline.stages.map((s, i) => (
                  <div key={s.name} className="flex items-center gap-1.5">
                    <span
                      className={`rounded-full border px-2 py-1 text-[10px] font-mono ${
                        s.failed
                          ? "border-error/30 bg-error/8 text-error/90"
                          : s.completed
                              ? "border-success/15 bg-success/8 text-success/80"
                              : "border-white/5 bg-white/[0.02] text-text-muted"
                      }`}
                      title={s.durationMs !== null ? `${s.durationMs.toFixed(1)}ms` : undefined}
                    >
                      {s.name}
                    </span>
                    {i < pipeline.stages.length - 1 && <span className="text-text-muted">→</span>}
                  </div>
                ))}
              </div>
            )}
            {pipeline?.error && <p className="text-[11px] text-error/80">Failed at {pipeline.failureStage}: {pipeline.error}</p>}
          </section>

          <section className="space-y-2">
            <h5 className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Runtime Inspector</h5>
            <pre className="max-h-40 overflow-auto rounded-lg bg-bg-elevated p-2.5 text-[10px] text-text-secondary">
              {runtime ? JSON.stringify(runtime, null, 2) : "No runtime snapshot available."}
            </pre>
          </section>

          <section className="space-y-2">
            <h5 className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Benchmark Inspector</h5>
            {!benchmark?.session ? (
              <p className="text-[11px] text-text-muted">No benchmark session recorded yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Session" value={benchmark.session.sessionId} />
                <Stat label="Executions" value={String(benchmark.session.executionCount)} />
                <Stat label="Last Run" value={fmtClock(benchmark.session.lastTimestamp)} />
              </div>
            )}
            {benchmark?.trading != null && (
              <pre className="max-h-40 overflow-auto rounded-lg bg-bg-elevated p-2.5 text-[10px] text-text-secondary">
                {JSON.stringify(benchmark.trading, null, 2)}
              </pre>
            )}
          </section>

          <section className="space-y-2">
            <h5 className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-text-muted">
              <span>Live Operations Terminal (Raw Logs)</span>
              <Badge tone={terminalConnected ? "success" : "neutral"} dot>{terminalConnected ? "Live" : "Idle"}</Badge>
            </h5>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
                <input
                  value={terminalQuery}
                  onChange={(e) => setTerminalQuery(e.target.value)}
                  placeholder="Filter stream…"
                  className="w-48 rounded-lg border border-white/5 bg-bg-elevated py-1.5 pl-7 pr-2.5 font-mono text-[11px] text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                />
              </div>
              <button className={BTN_CLS} onClick={() => setTerminalPaused((p) => !p)}>
                {terminalPaused ? <Play className="h-3 w-3" /> : <PauseIcon className="h-3 w-3" />}
                {terminalPaused ? "Resume" : "Pause"}
              </button>
            </div>
            <div ref={scrollRef} className="max-h-56 overflow-y-auto rounded-lg bg-bg-elevated px-2.5 py-2 font-mono text-[10px] leading-relaxed">
              {filteredRows.length === 0 ? (
                <p className="py-4 text-center text-text-muted">No events streamed yet.</p>
              ) : (
                filteredRows.map((r) => (
                  <div key={r.id} className="group flex items-start gap-2 border-b border-white/[0.03] py-1 last:border-0">
                    <span className="w-[70px] shrink-0 text-text-muted">{fmtClock(r.created_at)}</span>
                    <span className="w-28 shrink-0 uppercase tracking-wider text-text-secondary">{r.event_type}</span>
                    <span className="min-w-0 flex-1 truncate text-text-secondary">{r.message || r.signal || r.execution_status || ""}</span>
                    <button
                      onClick={() => copyRow(r)}
                      className="shrink-0 text-text-muted opacity-0 transition-opacity hover:text-text-primary group-hover:opacity-100"
                      title="Copy event JSON"
                    >
                      {copiedId === r.id ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-elevated px-2.5 py-1.5">
      <p className="text-[9px] uppercase tracking-widest text-text-muted">{label}</p>
      <p className="truncate font-mono text-xs text-text-primary">{value}</p>
    </div>
  );
}
