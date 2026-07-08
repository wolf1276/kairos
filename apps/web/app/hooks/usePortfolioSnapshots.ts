"use client";

import { useEffect, useState } from "react";

export interface PortfolioSnapshot {
  t: number; // timestamp ms
  v: number; // USD value
}

export interface PortfolioGrowth {
  changePct: number | null;
  windowLabel: "24h" | "since tracking began";
  baseline: PortfolioSnapshot | null;
  latest: PortfolioSnapshot | null;
  history: PortfolioSnapshot[];
}

const KEY_PREFIX = "kairos:portfolio-snapshots:";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_SAMPLE_GAP_MS = 5 * 60 * 1000;
const DISPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

function load(owner: string): PortfolioSnapshot[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + owner);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(owner: string, snapshots: PortfolioSnapshot[]) {
  try {
    localStorage.setItem(KEY_PREFIX + owner, JSON.stringify(snapshots));
  } catch {}
}

/** Drops this owner's cached portfolio-value history — called on logout so a reconnecting owner
 *  (or a different owner on a shared device) never sees another session's stale growth graph. */
export function clearPortfolioSnapshots(owner: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + owner);
  } catch {}
}

function deriveGrowth(snapshots: PortfolioSnapshot[]): PortfolioGrowth {
  if (snapshots.length < 2) {
    return {
      changePct: null,
      windowLabel: "since tracking began",
      baseline: null,
      latest: snapshots[0] ?? null,
      history: snapshots,
    };
  }
  const latest = snapshots[snapshots.length - 1];
  const oldest = snapshots[0];
  const now = Date.now();
  const withinWindow = snapshots.filter((s) => s.t >= now - DISPLAY_WINDOW_MS);

  let baseline: PortfolioSnapshot;
  let windowLabel: PortfolioGrowth["windowLabel"];
  if (oldest.t >= now - DISPLAY_WINDOW_MS) {
    baseline = oldest;
    windowLabel = "since tracking began";
  } else {
    baseline = withinWindow[0] ?? oldest;
    windowLabel = "24h";
  }

  const changePct = baseline.v > 0 ? ((latest.v - baseline.v) / baseline.v) * 100 : null;
  return { changePct, windowLabel, baseline, latest, history: snapshots };
}

export function usePortfolioSnapshots(owner: string | null, valueUsd: number | null): PortfolioGrowth {
  const [growth, setGrowth] = useState<PortfolioGrowth>({
    changePct: null,
    windowLabel: "since tracking began",
    baseline: null,
    latest: null,
    history: [],
  });

  // Load whatever history is already on disk as soon as we know the owner, so the growth
  // graph has something to render even before a fresh valueUsd arrives.
  useEffect(() => {
    if (!owner || typeof window === "undefined") return;
    const now = Date.now();
    const snapshots = load(owner).filter((s) => s.t >= now - RETENTION_MS);
    if (snapshots.length > 0) setGrowth(deriveGrowth(snapshots));
  }, [owner]);

  useEffect(() => {
    if (!owner || valueUsd == null || typeof window === "undefined") return;

    const now = Date.now();
    let snapshots = load(owner).filter((s) => s.t >= now - RETENTION_MS);

    const last = snapshots[snapshots.length - 1];
    const shouldAppend =
      !last || now - last.t >= MIN_SAMPLE_GAP_MS || Math.abs(valueUsd - last.v) > 0.01;

    if (shouldAppend) {
      snapshots = [...snapshots, { t: now, v: valueUsd }];
      save(owner, snapshots);
    }

    setGrowth(deriveGrowth(snapshots));
  }, [owner, valueUsd]);

  return growth;
}
