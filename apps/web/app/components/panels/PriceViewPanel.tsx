"use client";

import { useRef, useEffect, useState } from "react";
import { Card, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { ConfidenceRing } from "./ConfidenceRing";
import { useStreamingKlines } from "@/app/hooks/useStreamingKlines";
import { useMarketAnalysis } from "@/app/hooks/useMarketAnalysis";
import { formatPrice, formatPct, formatNumber } from "@/app/lib/format";
import type { WSStatus } from "@/app/hooks/usePrices";

interface Indicators {
  rsi: number;
  ema20: number;
  ema50: number;
  sma20: number;
  macd: { MACD: number; signal: number; histogram: number };
  atr: number;
}

export function PriceViewPanel({
  symbol,
  ticker,
  wsStatus,
  indicators,
}: {
  symbol: string;
  ticker?: { price: number; change24h: number; high24h: number; low24h: number };
  wsStatus?: WSStatus;
  indicators?: Indicators | null;
}) {
  const { candles, connected } = useStreamingKlines(symbol, "1h");
  const lastCandle = candles[candles.length - 1];
  const price = ticker?.price ?? lastCandle?.close ?? 0;

  const analysis = useMarketAnalysis(candles, price);

  const prevPriceRef = useRef(price);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (!price || price === prevPriceRef.current) return;
    setFlash(price > prevPriceRef.current ? "up" : "down");
    prevPriceRef.current = price;
    const t = setTimeout(() => setFlash(null), 300);
    return () => clearTimeout(t);
  }, [price]);

  const connTone =
    connected ? "success"
    : wsStatus === "reconnecting" || wsStatus === "connecting" ? "warning"
    : "neutral";

  const connLabel =
    connected ? "Live"
    : wsStatus === "reconnecting" ? "Reconnecting"
    : wsStatus === "connecting" ? "Connecting"
    : "Polling";

  const trendIcon = analysis.trend === "up" ? "▲" : analysis.trend === "down" ? "▼" : "—";
  const riskTone = analysis.risk === "low" ? "success" : analysis.risk === "high" ? "error" : "warning";
  const liqTone = analysis.liquidity === "high" ? "success" : analysis.liquidity === "low" ? "error" : "warning";

  return (
    <Card>
      <CardBody>
        {/* ── Top row: symbol + badge + confidence ring ── */}
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
              {symbol}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`font-mono text-lg font-bold tabular-nums transition-colors duration-200 ${
                  flash === "up"
                    ? "text-success"
                    : flash === "down"
                      ? "text-error"
                      : "text-text-primary"
                }`}
              >
                {price ? formatPrice(price) : "—"}
              </span>
              {ticker && (
                <span
                  className={`font-mono text-xs tabular-nums ${
                    ticker.change24h >= 0 ? "text-success" : "text-error"
                  }`}
                >
                  {formatPct(ticker.change24h)}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ConfidenceRing value={analysis.confidence} size={60} strokeWidth={4} />
            <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
              Confidence
            </span>
          </div>
        </div>

        {/* ── 24h High / Low strip ── */}
        {ticker && (
          <div className="mt-2 flex items-center gap-4 text-[11px] font-mono tabular-nums text-text-muted">
            <span>H: {formatPrice(ticker.high24h)}</span>
            <span>L: {formatPrice(ticker.low24h)}</span>
            <span className="ml-auto">
              <Badge tone={connTone} dot>
                {connLabel}
              </Badge>
            </span>
          </div>
        )}

        {/* ── 4-col stats grid ── */}
        <div className="mt-4 grid grid-cols-4 gap-3">
          <StatBox
            label="VWAP"
            value={analysis.vwap ? formatPrice(analysis.vwap) : "—"}
          />
          <StatBox
            label="Volatility"
            value={`${(analysis.volatility * 100).toFixed(2)}%`}
          />
          <StatBox
            label="Spread"
            value={(analysis.avgSpread * 100).toFixed(2) + "%"}
          />
          <StatBox
            label="Avg Vol"
            value={analysis.avgVolume ? formatNumber(analysis.avgVolume, 0) : "—"}
          />
        </div>

        {/* ── Market health row ── */}
        <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-xs ${
                analysis.trend === "up"
                  ? "text-success"
                  : analysis.trend === "down"
                    ? "text-error"
                    : "text-text-muted"
              }`}
            >
              {trendIcon}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
              {analysis.trend === "up"
                ? "Bullish"
                : analysis.trend === "down"
                  ? "Bearish"
                  : "Sideways"}
            </span>
          </div>

          <div className="h-3 w-px bg-border" />

          <span className="font-mono text-[10px] text-text-secondary">
            Mom{" "}
            <span
              className={
                analysis.momentum >= 0 ? "text-success" : "text-error"
              }
            >
              {analysis.momentum > 0 ? "+" : ""}
              {analysis.momentum.toFixed(1)}%
            </span>
          </span>

          <div className="h-3 w-px bg-border" />

          <Badge tone={riskTone}>
            {analysis.risk === "low" ? "Low Risk" : analysis.risk === "high" ? "High Risk" : "Med Risk"}
          </Badge>
          <Badge tone={liqTone}>
            {analysis.liquidity === "high"
              ? "High Liq"
              : analysis.liquidity === "low"
                ? "Low Liq"
                : "Med Liq"}
          </Badge>
        </div>

        {/* ── AI Summary ── */}
        {analysis.summary && (
          <p className="mt-3 border-t border-border pt-3 font-mono text-[11px] leading-relaxed text-text-secondary">
            {analysis.summary}
          </p>
        )}

        {/* ── Indicators from AI proposal ── */}
        {indicators && (
          <div className="mt-3 grid grid-cols-4 gap-3 border-t border-border pt-3">
            <StatBox label="RSI (14)" value={indicators.rsi.toFixed(1)} />
            <StatBox label="EMA 20" value={formatPrice(indicators.ema20)} />
            <StatBox label="EMA 50" value={formatPrice(indicators.ema50)} />
            <StatBox
              label="MACD Hist"
              value={indicators.macd.histogram.toFixed(4)}
              className={indicators.macd.histogram >= 0 ? "text-success" : "text-error"}
            />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function StatBox({
  label,
  value,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-widest text-text-muted">
        {label}
      </p>
      <p className={`mt-0.5 truncate font-mono text-xs tabular-nums text-text-primary ${className}`}>
        {value}
      </p>
    </div>
  );
}
