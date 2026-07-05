"use client";

import { useState } from "react";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { useSmartWalletBalances } from "@/app/hooks/useSmartWalletBalances";
import { fetchAccountBalances, delegateXLM, withdrawFromSmartWallet } from "@/app/lib/stellar";
import { useEffect } from "react";
import { WalletPicker } from "@/app/components/WalletPicker";

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export default function DashboardOverview() {
  return null;
}
