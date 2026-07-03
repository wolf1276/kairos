"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DelegationRecord, JsonSafeDelegation, DelegationFilters, DelegationStats } from "../types/delegation";
import { signAuthEntryWithFreighter, signDelegationHashWithFreighter } from "@/app/lib/stellar";

function loadDelegations(owner: string): Map<string, JsonSafeDelegation> {
  try {
    const raw = localStorage.getItem(`kairos:delegations:${owner}`);
    if (!raw) return new Map();
    const entries: [string, JsonSafeDelegation][] = JSON.parse(raw);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function saveDelegations(owner: string, map: Map<string, JsonSafeDelegation>) {
  try {
    localStorage.setItem(`kairos:delegations:${owner}`, JSON.stringify(Array.from(map.entries())));
  } catch {}
}

// `delegator` is always the connected owner's smart wallet — `redeem_delegations` calls
// `execute_from_executor` on the delegator, which only exists on the CustomAccount contract,
// so a delegation can never be redeemed (or even listed meaningfully) without one deployed.
export function useDelegations(walletOwner: string | null, smartWalletAddress: string | null, networkPassphrase: string) {
  const [delegations, setDelegations] = useState<DelegationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DelegationStats>({
    activeCount: 0,
    policiesAttached: 0,
    revokedCount: 0,
  });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  const fullDelegationsRef = useRef<Map<string, JsonSafeDelegation>>(new Map());

  useEffect(() => {
    if (walletOwner) {
      fullDelegationsRef.current = loadDelegations(walletOwner);
    }
  }, [walletOwner]);

  const refresh = useCallback(async () => {
    if (!smartWalletAddress) {
      setDelegations([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "LIST_DELEGATIONS", delegator: smartWalletAddress }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const fromChain: DelegationRecord[] = (data.delegations ?? []).map(
        (d: { hash: string; disabled: boolean; delegator: string }) => ({
          ...d,
          full: fullDelegationsRef.current.get(d.hash),
        })
      );

      const chainHashes = new Set(fromChain.map((d) => d.hash));
      const sessionOnly: DelegationRecord[] = Array.from(fullDelegationsRef.current.entries())
        .filter(([hash]) => !chainHashes.has(hash))
        .map(([hash, full]) => ({ hash, disabled: false, delegator: full.delegator, full }));

      const all = [...sessionOnly, ...fromChain];
      setDelegations(all);

      setStats({
        activeCount: all.filter((d) => !d.disabled).length,
        policiesAttached: all.reduce((acc, d) => acc + (d.full?.caveats.length ?? 0), 0),
        revokedCount: all.filter((d) => d.disabled).length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [smartWalletAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createDelegation = useCallback(
    async (delegate: string, policies: Record<string, unknown>[]) => {
      if (!smartWalletAddress || !walletOwner) {
        throw new Error("Connect your wallet and deploy a smart wallet first.");
      }

      // One delegation per wallet: refuse to mint a second one while an active delegation
      // already exists on-chain for this wallet. Callers should revoke() the existing one
      // (or update its policy) instead of calling createDelegation again.
      const existingRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "GET_WALLET_DELEGATION", delegator: smartWalletAddress }),
      });
      const existing = await existingRes.json();
      if (existingRes.ok && existing.hash) {
        throw new Error(
          "This wallet already has an active delegation. Revoke it before creating a new one."
        );
      }

      // 1. Server builds the unsigned delegation (delegator = this wallet's smart wallet —
      // the only address `redeem_delegations` can actually execute against) and returns its
      // hash for the owner to sign.
      const prepareRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PREPARE_DELEGATION", delegate, delegator: smartWalletAddress, policies }),
      });
      const prepared = await prepareRes.json();
      if (!prepareRes.ok) throw new Error(prepared.error);

      // 2. The wallet owner signs the hash via Freighter's SEP-53 `signMessage` — this is
      // what the smart wallet's `is_valid_signature` verifies on-chain.
      const signatureHex = await signDelegationHashWithFreighter(prepared.hashHex, networkPassphrase, walletOwner);

      // 3. Server attaches the signature and returns the final signed delegation.
      const submitRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SUBMIT_DELEGATION",
          unsignedDelegation: prepared.unsignedDelegation,
          signatureHex,
        }),
      });
      const data = await submitRes.json();
      if (!submitRes.ok) throw new Error(data.error);

      // 4. Register this as the wallet's single active delegation on-chain (WalletDelegation
      // map) — shared by every agent/execution mode for this wallet. Requires a second signed
      // authorization entry from the owner (register_delegation calls delegator.require_auth()).
      const registerPrepareRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PREPARE_REGISTER_DELEGATION", delegation: data.delegation }),
      });
      const registerPrepared = await registerPrepareRes.json();
      if (!registerPrepareRes.ok) throw new Error(registerPrepared.error);

      const registerSignedEntryXdr = await signAuthEntryWithFreighter(
        registerPrepared.unsignedEntryXdr,
        registerPrepared.validUntilLedgerSeq,
        networkPassphrase,
        walletOwner
      );

      const registerSubmitRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SUBMIT_REGISTER_DELEGATION",
          delegation: data.delegation,
          signedEntryXdr: registerSignedEntryXdr,
        }),
      });
      const registerData = await registerSubmitRes.json();
      if (!registerSubmitRes.ok) throw new Error(registerData.error);

      // 5. Seed the actual policy terms on-chain — the delegation's caveats only carry
      // `0xFE`-marker pointers (see PREPARE_DELEGATION), so without this the policies
      // resolve to empty terms and every redemption is blocked. One more signed auth entry.
      if (prepared.pendingPolicies?.length) {
        const seedPrepareRes = await fetch("/api/delegate-sdk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "PREPARE_SEED_POLICIES",
            delegator: smartWalletAddress,
            policies: prepared.pendingPolicies,
          }),
        });
        const seedPrepared = await seedPrepareRes.json();
        if (!seedPrepareRes.ok) throw new Error(seedPrepared.error);

        const seedSignedEntryXdr = await signAuthEntryWithFreighter(
          seedPrepared.unsignedEntryXdr,
          seedPrepared.validUntilLedgerSeq,
          networkPassphrase,
          walletOwner
        );

        const seedSubmitRes = await fetch("/api/delegate-sdk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "SUBMIT_SEED_POLICIES",
            delegator: smartWalletAddress,
            policies: prepared.pendingPolicies,
            signedEntryXdr: seedSignedEntryXdr,
          }),
        });
        const seedData = await seedSubmitRes.json();
        if (!seedSubmitRes.ok) throw new Error(seedData.error);
      }

      fullDelegationsRef.current.set(data.hash, data.delegation as JsonSafeDelegation);
      saveDelegations(walletOwner, fullDelegationsRef.current);
      await refresh();
      return data.hash as string;
    },
    [walletOwner, smartWalletAddress, networkPassphrase, refresh]
  );

  const refreshSingle = useCallback(
    async (hash: string): Promise<boolean> => {
      if (!smartWalletAddress) return false;
      try {
        const res = await fetch("/api/delegate-sdk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "LIST_DELEGATIONS", delegator: smartWalletAddress }),
        });
        const data = await res.json();
        if (!res.ok) return false;
        const chain = (data.delegations ?? []) as { hash: string; disabled: boolean }[];
        const match = chain.find((c) => c.hash === hash);
        if (match) {
          setDelegations((prev) => prev.map((x) => (x.hash === hash ? { ...x, disabled: match.disabled } : x)));
          setStats((prev) => {
            const wasActive = !match.disabled;
            return {
              ...prev,
              activeCount: prev.activeCount + (wasActive ? 1 : -1),
              revokedCount: prev.revokedCount + (wasActive ? -1 : 1),
            };
          });
        }
        return true;
      } catch {
        return false;
      }
    },
    [smartWalletAddress]
  );

  const setDelegationDisabled = useCallback(
    async (d: DelegationRecord, disabled: boolean) => {
      if (!d.full || !walletOwner) return;
      const prepareAction = disabled ? "PREPARE_REVOKE_DELEGATION" : "PREPARE_ENABLE_DELEGATION";
      const submitAction = disabled ? "SUBMIT_REVOKE_DELEGATION" : "SUBMIT_ENABLE_DELEGATION";
      const label = disabled ? "revoke" : "enable";
      setActionLoading(d.hash);
      setActionErrors((prev) => ({ ...prev, [d.hash]: "" }));
      try {
        const prepareRes = await fetch("/api/delegate-sdk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: prepareAction, delegation: d.full }),
        });
        const prepared = await prepareRes.json();
        if (!prepareRes.ok) {
          const errMsg = (prepared.error as string) || "";
          // Error(Contract, #2) = AlreadyDisabled, Error(Contract, #3) = AlreadyEnabled
          // The delegation's on-chain state doesn't match local state — reconcile.
          if (errMsg.includes("Error(Contract, #2)") || errMsg.includes("AlreadyDisabled")) {
            setDelegations((prev) => prev.map((x) => (x.hash === d.hash ? { ...x, disabled: true } : x)));
            setStats((prev) => ({
              ...prev,
              activeCount: Math.max(0, prev.activeCount - 1),
              revokedCount: prev.revokedCount + 1,
            }));
            throw new Error(`Delegation was already revoked on-chain. Local state updated.`);
          }
          if (errMsg.includes("Error(Contract, #3)") || errMsg.includes("AlreadyEnabled")) {
            setDelegations((prev) => prev.map((x) => (x.hash === d.hash ? { ...x, disabled: false } : x)));
            setStats((prev) => ({
              ...prev,
              activeCount: prev.activeCount + 1,
              revokedCount: Math.max(0, prev.revokedCount - 1),
            }));
            throw new Error(`Delegation is already enabled on-chain. Local state updated.`);
          }
          throw new Error(errMsg);
        }

        const signedEntryXdr = await signAuthEntryWithFreighter(
          prepared.unsignedEntryXdr,
          prepared.validUntilLedgerSeq,
          networkPassphrase,
          walletOwner
        );

        const submitRes = await fetch("/api/delegate-sdk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: submitAction, delegation: d.full, signedEntryXdr }),
        });
        const data = await submitRes.json();
        if (!submitRes.ok) {
          const errMsg = (data.error as string) || "";
          if (errMsg.includes("Error(Contract, #2)") || errMsg.includes("Error(Contract, #3)")) {
            await refreshSingle(d.hash);
            throw new Error(`Delegation state changed before ${label} could complete. Refreshed.`);
          }
          throw new Error(errMsg);
        }

        setDelegations((prev) => prev.map((x) => (x.hash === d.hash ? { ...x, disabled } : x)));
        setStats((prev) => ({
          ...prev,
          activeCount: Math.max(0, prev.activeCount + (disabled ? -1 : 1)),
          revokedCount: Math.max(0, prev.revokedCount + (disabled ? 1 : -1)),
        }));
      } catch (e) {
        setActionErrors((prev) => ({ ...prev, [d.hash]: e instanceof Error ? e.message : String(e) }));
      } finally {
        setActionLoading(null);
      }
    },
    [walletOwner, networkPassphrase, refreshSingle]
  );

  /**
   * Updates one policy's terms in place (by caveat index, used as policy_id) without minting
   * a new delegation — only works for delegations created with policy-indirected (`0xFE`
   * marker) caveats, i.e. anything created via createDelegation after this refactor. `policy`
   * is a structured PolicyCreateParams object (same shape createDelegation's `policies` take).
   */
  const updatePolicy = useCallback(
    async (policyId: number, policy: Record<string, unknown>): Promise<void> => {
      if (!smartWalletAddress || !walletOwner) {
        throw new Error("Connect your wallet and deploy a smart wallet first.");
      }
      setActionLoading(smartWalletAddress);
      setActionErrors((prev) => ({ ...prev, [smartWalletAddress]: "" }));
      try {
        const prepareRes = await fetch("/api/delegate-sdk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "PREPARE_SET_POLICY",
            delegator: smartWalletAddress,
            policyId: policyId.toString(),
            policy,
          }),
        });
        const prepared = await prepareRes.json();
        if (!prepareRes.ok) throw new Error(prepared.error);

        const signedEntryXdr = await signAuthEntryWithFreighter(
          prepared.unsignedEntryXdr,
          prepared.validUntilLedgerSeq,
          networkPassphrase,
          walletOwner
        );

        const submitRes = await fetch("/api/delegate-sdk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "SUBMIT_SET_POLICY",
            delegator: smartWalletAddress,
            policyId: policyId.toString(),
            policy,
            signedEntryXdr,
          }),
        });
        const data = await submitRes.json();
        if (!submitRes.ok) throw new Error(data.error);

        await refresh();
      } catch (e) {
        setActionErrors((prev) => ({ ...prev, [smartWalletAddress]: e instanceof Error ? e.message : String(e) }));
        throw e;
      } finally {
        setActionLoading(null);
      }
    },
    [smartWalletAddress, walletOwner, networkPassphrase, refresh]
  );

  const revoke = useCallback((d: DelegationRecord) => setDelegationDisabled(d, true), [setDelegationDisabled]);
  const enable = useCallback((d: DelegationRecord) => setDelegationDisabled(d, false), [setDelegationDisabled]);

  /**
   * Revokes by wallet address alone — doesn't need the full `Delegation` struct on hand
   * (the manager resolves it via the WalletDelegation map). Blocks every agent/execution
   * mode tied to this wallet in one call, mirroring the backend's revokeWalletDelegation.
   */
  const revokeByWallet = useCallback(async (): Promise<void> => {
    if (!smartWalletAddress || !walletOwner) return;
    setActionLoading(smartWalletAddress);
    setActionErrors((prev) => ({ ...prev, [smartWalletAddress]: "" }));
    try {
      const prepareRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PREPARE_REVOKE_BY_WALLET", delegator: smartWalletAddress }),
      });
      const prepared = await prepareRes.json();
      if (!prepareRes.ok) throw new Error(prepared.error);

      const signedEntryXdr = await signAuthEntryWithFreighter(
        prepared.unsignedEntryXdr,
        prepared.validUntilLedgerSeq,
        networkPassphrase,
        walletOwner
      );

      const submitRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SUBMIT_REVOKE_BY_WALLET",
          delegator: smartWalletAddress,
          signedEntryXdr,
        }),
      });
      const data = await submitRes.json();
      if (!submitRes.ok) throw new Error(data.error);

      await refresh();
    } catch (e) {
      setActionErrors((prev) => ({ ...prev, [smartWalletAddress]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setActionLoading(null);
    }
  }, [smartWalletAddress, walletOwner, networkPassphrase, refresh]);

  const filteredDelegations = useCallback((filters: DelegationFilters): DelegationRecord[] => {
    let result = [...delegations];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (d) =>
          d.hash.toLowerCase().includes(q) ||
          d.delegator.toLowerCase().includes(q) ||
          d.full?.delegate.toLowerCase().includes(q)
      );
    }

    if (filters.status !== "all") {
      const isActive = filters.status === "active";
      result = result.filter((d) => d.disabled !== isActive);
    }

    switch (filters.sort) {
      case "newest":
        result.sort((a, b) => b.hash.localeCompare(a.hash));
        break;
      case "oldest":
        result.sort((a, b) => a.hash.localeCompare(b.hash));
        break;
    }

    return result;
  }, [delegations]);

  return {
    delegations,
    stats,
    loading,
    error,
    actionLoading,
    actionErrors,
    refresh,
    createDelegation,
    updatePolicy,
    revoke,
    revokeByWallet,
    enable,
    filteredDelegations,
  };
}
