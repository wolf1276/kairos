"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type AppMode = "paper" | "testnet" | "mainnet";

const STORAGE_KEY = "kairos:app-mode";

function readStored(): AppMode {
  if (typeof window === "undefined") return "testnet";
  return (localStorage.getItem(STORAGE_KEY) as AppMode) ?? "testnet";
}

function writeStored(mode: AppMode) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, mode);
}

interface ModeContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>(readStored);

  const setMode = useCallback((m: AppMode) => {
    setModeState(m);
    writeStored(m);
  }, []);

  return (
    <ModeContext.Provider value={{ mode, setMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode(): ModeContextValue {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be used within <ModeProvider>");
  return ctx;
}
