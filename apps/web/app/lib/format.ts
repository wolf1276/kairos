// Locale-aware, layout-shift-safe formatting helpers.

export function formatUsd(value: number, opts?: { compact?: boolean; dp?: number }): string {
  if (!Number.isFinite(value)) return "$0.00";
  if (opts?.compact && Math.abs(value) >= 1000) {
    return `$${new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value)}`;
  }
  const dp = opts?.dp ?? 2;
  return `$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(value)}`;
}

// Prices span many magnitudes (BTC ~67000, XLM ~0.12). Pick sensible precision.
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const dp = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return `$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: dp,
  }).format(value)}`;
}

export function formatNumber(value: number, dp = 4): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  }).format(value);
}

export function formatPct(value: number, dp = 2): string {
  if (!Number.isFinite(value)) return "0.00%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(dp)}%`;
}

export function formatSignedUsd(value: number, opts?: { compact?: boolean }): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatUsd(Math.abs(value), opts)}`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function baseAsset(symbol: string): string {
  return symbol.replace(/USDT$|USDC$|USD$/i, "");
}

export function pnlColor(value: number): string {
  return value > 0 ? "text-success" : value < 0 ? "text-error" : "text-text-secondary";
}
