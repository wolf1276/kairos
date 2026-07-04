"use client";

import { useCallback, useState } from "react";
import { signDelegationHashWithFreighter } from "@/app/lib/stellar";

export type DelegationStatus = "preparing" | "signing" | "submitting" | null;

export interface CreatedDelegation {
  hash: string;
  delegation: Record<string, unknown>;
}

// Canonical agent-deploy step order used by every launch flow (Trade, Autonomous, Agents
// pages): strategy/intent chosen -> policies computed from it -> delegation prepared/signed/
// submitted (this hook) -> attachAgentDelegation -> setAgentStrategy (if not already set) ->
// startAgentWallet. Keep new launch flows on this order rather than inventing a different one.
export function useCreateDelegation(networkPassphrase: string, walletOwner: string | null) {
  const [status, setStatus] = useState<DelegationStatus>(null);
  const [error, setError] = useState<string | null>(null);

  const createDelegation = useCallback(async (
    delegate: string,
    delegator: string,
    policies: Record<string, unknown>[]
  ): Promise<CreatedDelegation | null> => {
    if (!walletOwner) {
      setError("Connect your wallet first.");
      return null;
    }
    try {
      setError(null);
      setStatus("preparing");
      const prepareRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PREPARE_DELEGATION", delegate, delegator, policies }),
      });
      if (!prepareRes.ok) {
        const text = await prepareRes.text();
        throw new Error(`PREPARE_DELEGATION failed (${prepareRes.status}): ${text.slice(0, 200)}`);
      }
      const prepared = await prepareRes.json();

      setStatus("signing");
      const signatureHex = await signDelegationHashWithFreighter(prepared.hashHex, networkPassphrase, walletOwner);

      setStatus("submitting");
      const submitRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT_DELEGATION", unsignedDelegation: prepared.unsignedDelegation, signatureHex }),
      });
      if (!submitRes.ok) {
        const text = await submitRes.text();
        throw new Error(`SUBMIT_DELEGATION failed (${submitRes.status}): ${text.slice(0, 200)}`);
      }
      const data = await submitRes.json();

      return { hash: data.hash as string, delegation: data.delegation as Record<string, unknown> };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return null;
    } finally {
      setStatus(null);
    }
  }, [networkPassphrase, walletOwner]);

  return { createDelegation, status, error };
}
