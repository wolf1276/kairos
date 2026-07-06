"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAllocations,
  getAuditLog,
  type Allocations,
  type AuditLogRow,
} from "@/app/lib/agentsBackend";

export interface ActivityItem {
  label: string;
  time: number;
}

export interface ProtocolAllocations {
  allocations: Allocations | null;
  activity: ActivityItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const POLL_MS = 15_000;

function eventToLabel(event: AuditLogRow): string {
  return event.message ?? event.event_type;
}

/** Real per-protocol allocation + recent-activity data for the dashboard, replacing the
 *  hardcoded ALLOCATION/ACTIVITY mock arrays. Only fetches once the caller is authenticated
 *  against the agents backend (see agentsBackend.ts's module-level auth token). */
export function useProtocolAllocations(enabled: boolean): ProtocolAllocations {
  const [allocations, setAllocations] = useState<Allocations | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setError(null);
    try {
      const [allocationsResult, events] = await Promise.all([getAllocations(), getAuditLog({ limit: 8 })]);
      setAllocations(allocationsResult);
      setActivity(events.map((e) => ({ label: eventToLabel(e), time: e.created_at })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      if (!cancelled) await refresh();
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, refresh]);

  return { allocations, activity, loading, error, refresh };
}
