"use client";

import { useState, useCallback } from "react";
import type { ActivityEvent, ActivityEventType } from "../types/delegation";

const STORAGE_KEY = "kairos:delegation-activity";

function loadEvents(): ActivityEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveEvents(events: ActivityEvent[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {}
}

export function useActivityTimeline() {
  const [events, setEvents] = useState<ActivityEvent[]>(loadEvents);

  const addEvent = useCallback(
    (delegationHash: string, type: ActivityEventType, details?: string, txHash?: string) => {
      const newEvent: ActivityEvent = {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        delegationHash,
        type,
        timestamp: Date.now(),
        details,
        txHash,
      };
      setEvents((prev) => {
        const updated = [newEvent, ...prev].slice(0, 100);
        saveEvents(updated);
        return updated;
      });
    },
    []
  );

  const clearEvents = useCallback(() => {
    setEvents([]);
    saveEvents([]);
  }, []);

  return { events, addEvent, clearEvents };
}
