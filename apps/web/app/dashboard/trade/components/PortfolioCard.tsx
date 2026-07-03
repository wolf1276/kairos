"use client";

import { useState, useEffect } from "react";
import { getPortfolioOverview } from "@/app/lib/agentsBackend";
import { formatPct } from "@/app/lib/format";

export function PortfolioCard() {
  const [data, setData] = useState<{
    xlmPct: number;
    usdcPct: number;
    targetXlm: number;
    targetUsdc: number;
    driftPct: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const portfolio = await getPortfolioOverview();
        if (cancelled) return;
        setData({
          xlmPct: portfolio.allocation.xlmPct,
          usdcPct: portfolio.allocation.usdcPct,
          targetXlm: portfolio.targets.xlmPct,
          targetUsdc: portfolio.targets.usdcPct,
          driftPct: portfolio.targets.driftThresholdPct,
        });
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Portfolio Allocation</p>
        <p className="mt-2 text-[11px] text-text-muted">Loading…</p>
      </div>
    );
  }

  const isDrifted = data && Math.abs(data.xlmPct - data.targetXlm) > data.driftPct;
  const driftColor = isDrifted ? "text-warning" : "text-text-secondary";

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Portfolio Allocation</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-text-muted">XLM</span>
          <span className="font-mono text-xs text-text-primary">{data ? `${formatPct(data.xlmPct)}%` : "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-text-muted">USDC</span>
          <span className="font-mono text-xs text-text-primary">{data ? `${formatPct(data.usdcPct)}%` : "—"}</span>
        </div>
        <div className="my-1.5 border-t border-white/5" />
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-text-muted">Target XLM</span>
          <span className="font-mono text-xs text-text-secondary">{data ? `${data.targetXlm}%` : "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-text-muted">Drift</span>
          <span className={`font-mono text-xs ${driftColor}`}>{data ? `${Math.abs(data.xlmPct - data.targetXlm).toFixed(1)}%` : "—"}</span>
        </div>
      </div>
    </div>
  );
}
