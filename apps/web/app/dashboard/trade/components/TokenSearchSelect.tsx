"use client";

import { useState, useRef, useCallback } from "react";
import type { SwapAsset, AccountBalance } from "@/app/lib/stellar";

function formatBalance(balance: string): string {
  const n = parseFloat(balance);
  if (n === 0) return "0";
  if (n < 0.00001) return n.toExponential(2);
  if (n < 1) return n.toFixed(6);
  if (n < 1000) return n.toFixed(4);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function TokenSearchSelect({
  balances,
  value,
  onChange,
  label,
  otherAsset,
}: {
  balances: AccountBalance[];
  value: SwapAsset;
  onChange: (asset: SwapAsset) => void;
  label: string;
  otherAsset: SwapAsset;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
    setSearch("");
  }, []);

  const handleContainerBlur = useCallback(
    (e: React.FocusEvent) => {
      if (!containerRef.current?.contains(e.relatedTarget as Node)) {
        close();
      }
    },
    [close],
  );

  const isCustom = useCallback(
    (input: string): SwapAsset | null => {
      const trimmed = input.trim().toUpperCase();
      if (!trimmed) return null;
      const parts = trimmed.split(":");
      if (parts.length === 2 && parts[0] && parts[1].startsWith("G")) {
        return { code: parts[0], issuer: parts[1] };
      }
      if (parts[0] === "XLM") {
        return { code: "XLM" };
      }
      return null;
    },
    [],
  );

  const filtered = balances.filter((b) => {
    const q = search.toUpperCase();
    if (!q) return true;
    const matchCode = b.code.toUpperCase().includes(q);
    const matchIssuer = b.issuer?.toUpperCase().includes(q);
    return matchCode || matchIssuer;
  });

  const selectedLabel = value.issuer ? `${value.code}:${value.issuer.slice(0, 4)}…` : value.code;

  const handleSelect = useCallback(
    (asset: SwapAsset) => {
      if (asset.code === otherAsset.code && asset.issuer === otherAsset.issuer) return;
      onChange(asset);
      close();
    },
    [otherAsset, onChange, close],
  );

  const queryAsset = isCustom(search);

  return (
    <div ref={containerRef} onBlur={handleContainerBlur} className="relative">
      <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
        {label}
      </label>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5 text-sm font-mono text-text-primary transition-all duration-200 hover:border-white/10"
      >
        <span>{selectedLabel}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-white/5 bg-bg-elevated shadow-2xl animate-fade-in-up">
          <div className="p-2">
            <input
              type="text"
              placeholder="Search code or CODE:ISSUER"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="w-full rounded-lg border border-white/5 bg-bg-primary px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted/50 outline-none transition-all duration-200 focus:border-accent/30 focus:ring-2 focus:ring-accent/15"
            />
          </div>

          <div className="max-h-48 overflow-y-auto">
            {filtered.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-text-muted">
                  Your Balances
                </div>
                {filtered.map((b) => {
                  const asset: SwapAsset = b.code === "XLM" ? { code: "XLM" } : { code: b.code, issuer: b.issuer };
                  const disabled = asset.code === otherAsset.code && asset.issuer === otherAsset.issuer;
                  const selected =
                    asset.code === value.code && asset.issuer === value.issuer;
                  return (
                    <button
                      key={`${b.code}:${b.issuer ?? "native"}`}
                      type="button"
                      disabled={disabled}
                      onClick={() => handleSelect(asset)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left transition-all duration-150 ${
                        disabled
                          ? "cursor-not-allowed opacity-30"
                          : selected
                            ? "bg-accent/10 cursor-pointer"
                            : "hover:bg-white/[0.03] cursor-pointer"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.04] font-mono text-[10px] font-bold text-text-secondary">
                          {b.code.slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-mono text-xs text-text-primary">{b.code}</div>
                          {b.issuer && (
                            <div className="font-mono text-[9px] text-text-muted">
                              {b.issuer.slice(0, 6)}…{b.issuer.slice(-4)}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-xs text-text-secondary">
                          {formatBalance(b.balance)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </>
            )}

            {search.trim() && queryAsset && (
              <button
                type="button"
                onClick={() => handleSelect(queryAsset)}
                className="flex w-full items-center gap-2 border-t border-white/5 px-3 py-2.5 text-left hover:bg-white/[0.03] cursor-pointer transition-all duration-150"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 font-mono text-[10px] font-bold text-accent">
                  +
                </div>
                <div>
                  <div className="font-mono text-xs text-text-primary">
                    {queryAsset.code}
                    {queryAsset.issuer && (
                      <span className="text-text-muted">:{queryAsset.issuer.slice(0, 8)}…</span>
                    )}
                  </div>
                  <div className="text-[10px] text-text-muted">Use custom asset</div>
                </div>
              </button>
            )}

            {search.trim() && !queryAsset && filtered.length === 0 && (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-text-muted">
                  Type <span className="font-mono text-accent">CODE:ISSUER</span> to add a custom token
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
