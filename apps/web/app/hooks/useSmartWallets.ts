"use client";

import { useCallback, useState } from "react";
import { fetchSmartWalletBalance, signAuthEntryWithWallet, type WalletState } from "@/app/lib/stellar";
import { listSmartWallets, registerSmartWallet } from "@/app/lib/agentsBackend";
import { checkOnboarding } from "@/app/lib/connectApi";

export interface SmartWalletInfo {
  address: string;
  label: string | null;
}

export interface MergeSmartWalletsResult {
  wallets: SmartWalletInfo[];
  /** True when the on-chain Registry check (the canonical source of truth) failed to run to a
   *  confirmed verdict — RPC failure, network error, simulation failure, timeout, or a non-2xx
   *  from /api/connect/check. When true, an empty `wallets` list must NOT be treated as "new
   *  user, safe to auto-provision a smart wallet": it means "we don't know", not "there isn't
   *  one". Only false (and empty `wallets`) means the Registry was actually consulted and
   *  confirmed no wallet exists. */
  checkFailed: boolean;
}

const SELECTED_KEY_PREFIX = "kairos:smart-wallet:"; // pointer to the currently-selected wallet
const LIST_KEY_PREFIX = "kairos:smart-wallets:"; // this owner's full set of smart wallets

function loadWalletList(owner: string): SmartWalletInfo[] {
  try {
    const raw = localStorage.getItem(LIST_KEY_PREFIX + owner);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
    // Pre-multi-wallet installs only ever stored a single scalar address under the selected key —
    // fold that into a one-item list instead of losing it.
    const legacyScalar = localStorage.getItem(SELECTED_KEY_PREFIX + owner);
    if (legacyScalar) return [{ address: legacyScalar, label: null }];
  } catch {
    // fall through
  }
  return [];
}

function saveWalletList(owner: string, wallets: SmartWalletInfo[]) {
  try {
    localStorage.setItem(LIST_KEY_PREFIX + owner, JSON.stringify(wallets));
  } catch {}
}

function loadSelected(owner: string): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY_PREFIX + owner);
  } catch {
    return null;
  }
}

function saveSelected(owner: string, address: string) {
  try {
    localStorage.setItem(SELECTED_KEY_PREFIX + owner, address);
  } catch {}
}

export interface UseSmartWalletsResult {
  /** Every smart wallet this owner has deployed — lets callers offer a picker instead of
   *  always using the single selected one. */
  smartWallets: SmartWalletInfo[];
  /** The currently-selected smart wallet (smart account) agents delegate from by default. */
  smartWalletAddress: string | null;
  smartWalletBalance: string | null;
  deploying: boolean;
  deployError: string | null;
  /** Switches which smart wallet is "selected" (the default for new agent launches). */
  selectWallet: (address: string) => void;
  checkBalance: (address: string) => Promise<void>;
  /** Manual "add another smart wallet" path (in addition to any existing ones) — separate
   *  from the automatic first-time onboarding flow in app/services/onboarding, which provisions
   *  the *first* one without the user ever calling this. */
  deploySmartWallet: (label?: string) => Promise<void>;
  /** Reconciles this owner's local (per-browser) smart-wallet list with the backend's copy —
   *  pure read, doesn't touch selection/balance state. The composer decides what an empty
   *  result means (a new-user onboarding trigger) before calling `applySmartWallets` — but only
   *  when `checkFailed` is false: `checkFailed` means the on-chain Registry check itself failed
   *  (RPC/network/simulation/timeout), so an empty `wallets` list is NOT a confirmed "no wallet"
   *  verdict and must never be treated as one (see mergeSmartWallets below). Pass the session
   *  token (not just an `authed` flag) so this can also fall back to the on-chain registry via
   *  /api/connect/check if the DB has no row (e.g. lost on a backend redeploy — see
   *  apps/web/app/api/connect/check/route.ts). */
  mergeSmartWallets: (owner: string, token: string | null) => Promise<MergeSmartWalletsResult>;
  /** Commits a resolved smart-wallet list for `wallet`, selects whichever address ends up
   *  selected (persisted selection, or the first in the list), and loads its balance. */
  applySmartWallets: (wallet: WalletState, wallets: SmartWalletInfo[]) => Promise<void>;
  /** Clears in-memory state AND this owner's persisted localStorage smart-wallet cache — called
   *  on logout. Without clearing storage, a stale cached list/selection would survive and get
   *  re-read on the next connect before the DB/registry reconciliation in mergeSmartWallets even
   *  runs, defeating "reconnect must restore from DB -> Registry, never browser cache". */
  reset: (owner: string | null) => void;
}

/**
 * Owns the set of smart wallets this owner has, which one is selected, and its
 * balance — plus the local<->remote reconciliation and localStorage persistence behind that.
 * Takes the currently-connected `wallet` as a parameter (rather than looking it up itself) so
 * it stays decoupled from Freighter/kit connection mechanics — see useWallet.ts for that.
 */
export function useSmartWallets(wallet: WalletState | null): UseSmartWalletsResult {
  const [smartWallets, setSmartWallets] = useState<SmartWalletInfo[]>([]);
  const [smartWalletAddress, setSmartWalletAddress] = useState<string | null>(null);
  const [smartWalletBalance, setSmartWalletBalance] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  const walletOwner = wallet?.address ?? null;

  const checkBalance = useCallback(
    async (address: string) => {
      if (!wallet) return;
      try {
        const balance = await fetchSmartWalletBalance(address, wallet.networkPassphrase, wallet.sorobanRpcUrl);
        setSmartWalletBalance(balance);
      } catch {}
    },
    [wallet]
  );

  const selectWallet = useCallback(
    (address: string) => {
      if (!walletOwner) return;
      setSmartWalletAddress(address);
      saveSelected(walletOwner, address);
      checkBalance(address);
    },
    [walletOwner, checkBalance]
  );

  const mergeSmartWallets = useCallback(async (owner: string, token: string | null): Promise<MergeSmartWalletsResult> => {
    const localList = loadWalletList(owner);
    // Merge in any wallets registered server-side (e.g. deployed from another browser/device) —
    // best-effort, skipped entirely if we have no session token to call the backend with yet.
    if (!token) return { wallets: localList, checkFailed: false };

    const byAddress = new Map(localList.map((w) => [w.address, w]));
    try {
      const remote = await listSmartWallets();
      for (const r of remote) {
        if (!byAddress.has(r.address)) byAddress.set(r.address, { address: r.address, label: r.label });
      }
    } catch {
      // DB list fetch failed — fall through to the Registry check below rather than trusting
      // the local list alone, since a DB outage must not be mistaken for "no wallets".
    }

    if (byAddress.size > 0) {
      return { wallets: Array.from(byAddress.values()), checkFailed: false };
    }

    // Neither the local cache nor the DB has a wallet for this owner (e.g. the DB row was lost
    // on a backend redeploy, or the DB fetch above failed). Fall back to the on-chain registry —
    // the canonical source of truth — before reporting "new user" and walking them through
    // deploying a (possibly second) smart wallet. A Registry check failure (RPC/network/
    // simulation/timeout, surfaced as a thrown ConnectApiError from a non-2xx /api/connect/check
    // response — see that route) must be reported as `checkFailed`, NOT silently swallowed into
    // an empty list: that would fail open into offering "Create Smart Wallet" to an owner whose
    // existing wallet we simply failed to look up.
    try {
      const onChain = await checkOnboarding(token);
      if (onChain.status === "existing" && onChain.smartWallet) {
        byAddress.set(onChain.smartWallet, { address: onChain.smartWallet, label: null });
      } else if (onChain.status !== "new") {
        return { wallets: [], checkFailed: true };
      }
    } catch {
      return { wallets: Array.from(byAddress.values()), checkFailed: true };
    }

    return { wallets: Array.from(byAddress.values()), checkFailed: false };
  }, []);

  const applySmartWallets = useCallback(async (w: WalletState, wallets: SmartWalletInfo[]) => {
    setSmartWallets(wallets);
    saveWalletList(w.address, wallets);

    const selected = loadSelected(w.address) ?? wallets[0]?.address ?? null;
    setSmartWalletAddress(selected);
    if (selected) {
      saveSelected(w.address, selected);
      try {
        const balance = await fetchSmartWalletBalance(selected, w.networkPassphrase, w.sorobanRpcUrl);
        setSmartWalletBalance(balance);
      } catch {}
    } else {
      // Either not authenticated yet, or the automatic onboarding deploy failed — see
      // useOnboarding's onboardingError/retryOnboarding.
      setSmartWalletBalance(null);
    }
  }, []);

  const deployWallet = useCallback(async (owner: string, w: WalletState): Promise<string> => {
    const prepareRes = await fetch("/api/delegate-sdk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "PREPARE_WALLET_DEPLOY", owner }),
    });
    if (!prepareRes.ok) {
      const text = await prepareRes.text();
      throw new Error(`PREPARE_WALLET_DEPLOY failed (${prepareRes.status}): ${text.slice(0, 200)}`);
    }
    const prepared = await prepareRes.json();
    if (prepared.alreadyExists) return prepared.smartWalletAddress as string;

    const signedEntryXdr = await signAuthEntryWithWallet(
      prepared.unsignedEntryXdr,
      prepared.validUntilLedgerSeq,
      w.networkPassphrase,
      owner
    );

    const submitRes = await fetch("/api/delegate-sdk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "SUBMIT_WALLET_DEPLOY",
        owner,
        saltHex: prepared.saltHex,
        signedEntryXdr,
      }),
    });
    if (!submitRes.ok) {
      const text = await submitRes.text();
      throw new Error(`SUBMIT_WALLET_DEPLOY failed (${submitRes.status}): ${text.slice(0, 200)}`);
    }
    const data = await submitRes.json();
    return data.smartWalletAddress as string;
  }, []);

  const deploySmartWallet = useCallback(
    async (label?: string) => {
      if (!walletOwner || !wallet) {
        setDeployError("Connect Freighter wallet first");
        return;
      }
      setDeploying(true);
      setDeployError(null);
      try {
        const address = await deployWallet(walletOwner, wallet);
        const next = [...smartWallets, { address, label: label ?? null }];
        setSmartWallets(next);
        saveWalletList(walletOwner, next);
        selectWallet(address);
        // The wallet is already live on-chain (irreversible) and usable locally, but persistence
        // to the backend DB/registry must be verified, not fire-and-forget — a swallowed failure
        // here would leave the wallet invisible to other devices/sessions with no signal to the
        // user that a retry is needed. Surface it via deployError instead of reporting silent
        // success; /api/connect/register is the retry path (see its route for the verify step).
        try {
          await registerSmartWallet(address, label);
        } catch (registerErr) {
          setDeployError(
            `Smart wallet deployed but failed to save — retry from another action to re-link it (${
              registerErr instanceof Error ? registerErr.message : String(registerErr)
            })`
          );
        }
      } catch (e) {
        setDeployError(e instanceof Error ? e.message : String(e));
      } finally {
        setDeploying(false);
      }
    },
    [walletOwner, wallet, deployWallet, smartWallets, selectWallet]
  );

  const reset = useCallback((owner: string | null) => {
    setSmartWallets([]);
    setSmartWalletAddress(null);
    setSmartWalletBalance(null);
    setDeployError(null);
    if (owner) {
      try {
        localStorage.removeItem(LIST_KEY_PREFIX + owner);
        localStorage.removeItem(SELECTED_KEY_PREFIX + owner);
      } catch {}
    }
  }, []);

  return {
    smartWallets,
    smartWalletAddress,
    smartWalletBalance,
    deploying,
    deployError,
    selectWallet,
    checkBalance,
    deploySmartWallet,
    mergeSmartWallets,
    applySmartWallets,
    reset,
  };
}
