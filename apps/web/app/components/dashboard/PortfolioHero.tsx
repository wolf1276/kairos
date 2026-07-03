"use client";

import { memo, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface PortfolioHeroProps {
  portfolioValue: string;
  changePct: number | null;
  delegatedCapital: string;
  availableCapital: string;
  automationStatus: "active" | "idle" | "error";
  currentStrategy: string;
  riskProfile: "Conservative" | "Moderate" | "Aggressive" | "Medium";
  marketRegime: string;
  aiConfidence: number;
  sparklineData: { t: number; v: number }[];
}

export function PortfolioHero({
  portfolioValue,
  changePct,
  delegatedCapital,
  availableCapital,
  automationStatus,
  currentStrategy,
  riskProfile,
  marketRegime,
  aiConfidence,
  sparklineData,
}: PortfolioHeroProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = canvas.offsetWidth;
    let height = canvas.offsetHeight;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    let time = 0;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      time += 0.005;

      // Subtle animated grid
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Animated glow
      const glowX = width * 0.3 + Math.sin(time * 0.5) * width * 0.1;
      const glowY = height * 0.5 + Math.cos(time * 0.3) * height * 0.2;
      const gradient = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, width * 0.4);
      gradient.addColorStop(0, "rgba(120, 81, 233, 0.08)");
      gradient.addColorStop(1, "rgba(120, 81, 233, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Sparkline drawing
      if (sparklineData.length >= 2) {
        const values = sparklineData.map((s) => s.v);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;
        const pad = 20;

        ctx.beginPath();
        sparklineData.forEach((s, i) => {
          const x = pad + (i / (sparklineData.length - 1)) * (width - pad * 2);
          const y = pad + (1 - (s.v - min) / range) * (height - pad * 2);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });

        const isPositive = values[values.length - 1] >= values[0];
        ctx.strokeStyle = isPositive ? "rgba(45, 212, 160, 0.4)" : "rgba(240, 81, 81, 0.4)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Fill under curve
        const lastX = pad + ((sparklineData.length - 1) / (sparklineData.length - 1)) * (width - pad * 2);
        ctx.lineTo(lastX, height);
        ctx.lineTo(pad, height);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, 0, 0, height);
        fillGrad.addColorStop(0, isPositive ? "rgba(45, 212, 160, 0.1)" : "rgba(240, 81, 81, 0.1)");
        fillGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = fillGrad;
        ctx.fill();
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    const handleResize = () => {
      width = canvas.offsetWidth;
      height = canvas.offsetHeight;
      canvas.width = width * window.devicePixelRatio;
      canvas.height = height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", handleResize);
    };
  }, [sparklineData]);

  const statusColor =
    automationStatus === "active"
      ? "text-success"
      : automationStatus === "error"
        ? "text-error"
        : "text-text-muted";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-bg-card p-8">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full opacity-60"
        style={{ pointerEvents: "none" }}
      />
      <div className="relative z-10">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
            Total Portfolio Value
          </p>
          <div className="flex items-baseline gap-4">
            <h2 className="font-display text-[48px] font-semibold tracking-tight text-text-primary tabular-nums">
              {portfolioValue}
            </h2>
            {changePct !== null && (
              <span
                className={cn(
                  "text-sm font-medium tabular-nums",
                  changePct >= 0 ? "text-success" : "text-error"
                )}
              >
                {changePct >= 0 ? "+" : ""}
                {changePct.toFixed(2)}%
              </span>
            )}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <HeroStat label="Delegated Capital" value={delegatedCapital} />
          <HeroStat label="Available Capital" value={availableCapital} />
          <HeroStat label="Strategy" value={currentStrategy} />
          <HeroStat
            label="AI Confidence"
            value={`${Math.round(aiConfidence * 100)}%`}
            trend={aiConfidence > 0.8 ? "high" : aiConfidence > 0.5 ? "medium" : "low"}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", statusColor, automationStatus === "active" && "animate-pulse")} />
            {automationStatus === "active" ? "Automation Active" : automationStatus === "error" ? "Automation Error" : "Automation Idle"}
          </span>
          <span className="text-text-muted">|</span>
          <span>Risk: {riskProfile}</span>
          <span className="text-text-muted">|</span>
          <span>Regime: {marketRegime}</span>
        </div>
      </div>
    </div>
  );
}

function HeroStat({ label, value, trend }: { label: string; value: string; trend?: "high" | "medium" | "low" }) {
  const trendColor = trend === "high" ? "text-success" : trend === "medium" ? "text-amber-400" : "text-error";
  return (
    <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-3">
      <p className="text-[10px] uppercase tracking-widest text-text-muted">{label}</p>
      <p className={cn("mt-1 font-mono text-sm font-medium tabular-nums", trend ? trendColor : "text-text-secondary")}>
        {value}
      </p>
    </div>
  );
}

export default memo(PortfolioHero);
