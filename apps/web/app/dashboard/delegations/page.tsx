"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Address, Asset, StrKey, xdr as stellarXdr } from "@stellar/stellar-sdk";
import DelegationKit from "@/app/components/DelegationKit";
import { Card, CardHeader, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Spinner } from "@/app/components/ui/Spinner";
import {
  fetchSmartWalletBalance,
  signAuthEntryWithFreighter,
  type WalletState,
} from "@/app/lib/stellar";

// Mirrors the API route's JSON-safe serialization of the SDK's `Delegation` type — `salt`/
// `nonce` are bigint and `terms` is a Uint8Array on the server, neither of which survives
// JSON.stringify, so the API sends/receives strings and number arrays instead.
interface JsonSafeDelegation {
  delegate: string;
  delegator: string;
  authority: string;
  caveats: { enforcer: string; terms: number[] }[];
  salt: string;
  nonce: string;
  signature: string;
}

interface DelegationRecord {
  hash: string;
  disabled: boolean;
  delegator: string;
  full?: JsonSafeDelegation;
}

const INPUT_CLS =
  "w-full rounded-lg border border-white/5 bg-bg-elevated px-2 py-1.5 font-mono text-xs text-text-primary transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30";

const BUTTON_CLS =
  "inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50";

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function toUnix(local: string): string {
  if (!local) return "";
  return Math.floor(new Date(local).getTime() / 1000).toString();
}

/**
 * Decodes a caveat's raw `terms` bytes back into a human-readable policy description.
 * Mirrors the byte layout `packages/sdk`'s `PolicyModule.decode()` uses on the server —
 * duplicated here (read-only, no signing) so returning users can see exactly what each
 * persisted delegation actually restricts, not just its hash.
 */
function describeCaveat(terms: number[]): string {
  try {
    const buf = Buffer.from(terms);
    if (buf.length === 0) return "Unknown policy";
    const typeTag = buf.readUInt8(0);

    if (typeTag === 1) {
      const scVal = stellarXdr.ScVal.fromXDR(buf.subarray(1));
      const target = Address.fromScVal(scVal).toString();
      return `Target whitelist: ${target}`;
    }

    if (typeTag === 2) {
      const token = StrKey.encodeContract(buf.subarray(1, 33));
      const hi = buf.readBigInt64BE(33);
      const lo = buf.readBigUInt64BE(41);
      const limit = (hi << BigInt(64)) | (lo & BigInt("0xffffffffffffffff"));
      const period = buf.readBigUInt64BE(49);
      return `Spend limit: ${limit.toString()} stroops / ${period.toString()}s window (token ${token.slice(0, 6)}…)`;
    }

    if (typeTag === 3) {
      const start = buf.readBigUInt64BE(1);
      const expiry = buf.readBigUInt64BE(9);
      const fmt = (u: bigint) => (u === BigInt(0) ? "—" : new Date(Number(u) * 1000).toLocaleString());
      return `Time window: ${fmt(start)} → ${fmt(expiry)}`;
    }

    return "Unknown policy";
  } catch {
    return "Unreadable policy";
  }
}

// Deployed smart wallets and created delegations are persisted per connected owner address so
// reconnecting Freighter (or reloading the page) restores prior state instead of forcing a
// re-deploy — without this, `smartWalletAddress` and `fullDelegationsRef` were pure in-memory
// React state, wiped on every reload/reconnect even though the on-chain wallet still exists.
const smartWalletStorageKey = (owner: string) => `kairos:smart-wallet:${owner}`;
const delegationsStorageKey = (owner: string) => `kairos:delegations:${owner}`;

function loadSmartWallet(owner: string): string | null {
  try {
    return localStorage.getItem(smartWalletStorageKey(owner));
  } catch {
    return null;
  }
}

function saveSmartWallet(owner: string, address: string) {
  try {
    localStorage.setItem(smartWalletStorageKey(owner), address);
  } catch {
    // Persistence is best-effort; deployment already succeeded on-chain.
  }
}

function loadDelegations(owner: string): Map<string, JsonSafeDelegation> {
  try {
    const raw = localStorage.getItem(delegationsStorageKey(owner));
    if (!raw) return new Map();
    const entries: [string, JsonSafeDelegation][] = JSON.parse(raw);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function saveDelegations(owner: string, map: Map<string, JsonSafeDelegation>) {
  try {
    localStorage.setItem(delegationsStorageKey(owner), JSON.stringify(Array.from(map.entries())));
  } catch {
    // Persistence is best-effort; the delegation is already valid on-chain regardless.
  }
}

export default function DelegationsPage() {
  // ── Connected Freighter wallet (owns any smart wallet we deploy) ──
  const [connectedWallet, setConnectedWallet] = useState<WalletState | null>(
    null
  );
  const walletOwner = connectedWallet?.address ?? null;

  // ── Smart wallet deploy state ──
  const [smartWalletAddress, setSmartWalletAddress] = useState<string | null>(
    null
  );
  const [smartWalletBalance, setSmartWalletBalance] = useState<string | null>(
    null
  );
  const [deployingWallet, setDeployingWallet] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  // ── Create delegation state ──
  const [creatingDelegation, setCreatingDelegation] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<DelegationRecord | null>(
    null
  );

  // ── Active delegations list ──
  const [delegations, setDelegations] = useState<DelegationRecord[]>([]);
  const [delegationsLoading, setDelegationsLoading] = useState(false);
  const [delegationsError, setDelegationsError] = useState<string | null>(
    null
  );
  const [revokingHash, setRevokingHash] = useState<string | null>(null);
  const [enablingHash, setEnablingHash] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>(
    {}
  );

  // Full Delegation structs are only known for delegations created this session — `list()`
  // only returns hashes/status from on-chain events, not the full struct disable()/enable() need.
  const fullDelegationsRef = useRef<Map<string, JsonSafeDelegation>>(new Map());

  // ── Delegate target: the smart wallet's own owner, or an AI agent's ephemeral session key ──
  const [delegateMode, setDelegateMode] = useState<"smart-wallet" | "agent">(
    "smart-wallet"
  );
  const [agentPubkey, setAgentPubkey] = useState("");
  const [copiedExport, setCopiedExport] = useState(false);

  // ── Policy (caveat) builder state ──
  const [targetWhitelistEnabled, setTargetWhitelistEnabled] = useState(false);
  const [targetWhitelistAddress, setTargetWhitelistAddress] = useState("");
  const [spendLimitEnabled, setSpendLimitEnabled] = useState(false);
  const [spendLimitToken, setSpendLimitToken] = useState("");
  const [spendLimitAmount, setSpendLimitAmount] = useState("");
  const [spendLimitPeriod, setSpendLimitPeriod] = useState("86400");
  const [timeRestrictionEnabled, setTimeRestrictionEnabled] = useState(false);
  const [timeStart, setTimeStart] = useState("");
  const [timeExpiry, setTimeExpiry] = useState("");

  const checkSmartWalletBalance = async (address: string) => {
    if (!connectedWallet) return;
    try {
      const balance = await fetchSmartWalletBalance(
        address,
        connectedWallet.networkPassphrase,
        connectedWallet.sorobanRpcUrl
      );
      setSmartWalletBalance(balance);
    } catch {
      // Balance check is best-effort; deployment already succeeded.
    }
  };

  const refreshDelegations = useCallback(async () => {
    setDelegationsLoading(true);
    setDelegationsError(null);
    try {
      const res = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "LIST_DELEGATIONS" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const fromChain: DelegationRecord[] = (data.delegations ?? []).map(
        (d: { hash: string; disabled: boolean; delegator: string }) => ({
          ...d,
          full: fullDelegationsRef.current.get(d.hash),
        })
      );

      // The DelegationManager contract only emits events on disable/enable/redeem, never on
      // creation — a freshly created delegation is a pure off-chain signature until one of
      // those happens, so it will never show up via LIST_DELEGATIONS's on-chain event query.
      // Merge in anything created this session that the chain doesn't know about yet.
      const chainHashes = new Set(fromChain.map((d) => d.hash));
      const sessionOnly: DelegationRecord[] = Array.from(
        fullDelegationsRef.current.entries()
      )
        .filter(([hash]) => !chainHashes.has(hash))
        .map(([hash, full]) => ({ hash, disabled: false, delegator: full.delegator, full }));

      setDelegations([...sessionOnly, ...fromChain]);
    } catch (e) {
      setDelegationsError(e instanceof Error ? e.message : String(e));
    } finally {
      setDelegationsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshDelegations();
  }, [refreshDelegations]);

  // Restore this owner's previously deployed smart wallet and session-created delegations
  // (persisted to localStorage) whenever Freighter (re)connects.
  useEffect(() => {
    if (!walletOwner) {
      setSmartWalletAddress(null);
      setSmartWalletBalance(null);
      return;
    }

    fullDelegationsRef.current = loadDelegations(walletOwner);
    refreshDelegations();

    const savedWallet = loadSmartWallet(walletOwner);
    if (savedWallet) {
      setSmartWalletAddress(savedWallet);
      checkSmartWalletBalance(savedWallet);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletOwner]);

  const handleDeployWallet = async () => {
    if (!walletOwner || !connectedWallet) {
      setDeployError("Connect your Freighter wallet before deploying a smart wallet.");
      return;
    }
    setDeployingWallet(true);
    setDeployError(null);
    try {
      // 1. Server builds the sponsored deploy (funder pays fees) and returns the
      // unsigned authorization entry the owner address must sign.
      const prepareRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "PREPARE_WALLET_DEPLOY",
          owner: walletOwner,
        }),
      });
      const prepared = await prepareRes.json();
      if (!prepareRes.ok) throw new Error(prepared.error);

      // 2. Freighter signs just the auth entry — the connected wallet authorizes its
      // own participation but pays nothing; the funder still covers all fees.
      const signedEntryXdr = await signAuthEntryWithFreighter(
        prepared.unsignedEntryXdr,
        prepared.validUntilLedgerSeq,
        connectedWallet.networkPassphrase,
        walletOwner
      );

      // 3. Server splices the signed entry back in and submits (funder-signed tx).
      const submitRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SUBMIT_WALLET_DEPLOY",
          owner: walletOwner,
          saltHex: prepared.saltHex,
          signedEntryXdr,
        }),
      });
      const data = await submitRes.json();
      if (!submitRes.ok) throw new Error(data.error);
      setSmartWalletAddress(data.smartWalletAddress);
      saveSmartWallet(walletOwner, data.smartWalletAddress);
      await checkSmartWalletBalance(data.smartWalletAddress);
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeployingWallet(false);
    }
  };

  const handleCreateDelegation = async () => {
    if (!smartWalletAddress) return;
    if (delegateMode === "agent" && !StrKey.isValidEd25519PublicKey(agentPubkey)) {
      setCreateError(
        "Enter the agent's public key (from `kairos-mcp-agent-keygen`) — must be a valid G... address."
      );
      return;
    }
    setCreateError(null);
    setCreatingDelegation(true);
    setLastCreated(null);
    try {
      const policies: Record<string, unknown>[] = [];
      if (targetWhitelistEnabled && targetWhitelistAddress) {
        policies.push({ type: "target-whitelist", target: targetWhitelistAddress });
      }
      if (spendLimitEnabled && spendLimitAmount) {
        policies.push({
          type: "spend-limit",
          token:
            spendLimitToken ||
            Asset.native().contractId(
              connectedWallet?.networkPassphrase ?? "Test SDF Network ; September 2015"
            ),
          spendLimit: spendLimitAmount,
          period: spendLimitPeriod,
        });
      }
      if (timeRestrictionEnabled && timeStart && timeExpiry) {
        policies.push({
          type: "time-restriction",
          start: toUnix(timeStart),
          expiry: toUnix(timeExpiry),
        });
      }

      const res = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_DELEGATION",
          // The delegate is the entity permitted to redeem this delegation on-chain — either
          // the smart wallet's own owner, or (in "agent" mode) an AI agent's ephemeral session
          // key, scoped down by whatever caveats are attached below. The delegator is derived
          // server-side from FUNDER_SECRET_KEY, since that's the only key that can produce a
          // signature the DelegationManager contract will accept.
          delegate: delegateMode === "agent" ? agentPubkey : smartWalletAddress,
          policies,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      fullDelegationsRef.current.set(data.hash, data.delegation as JsonSafeDelegation);
      if (walletOwner) saveDelegations(walletOwner, fullDelegationsRef.current);
      setLastCreated({
        hash: data.hash,
        disabled: false,
        delegator: data.delegator,
        full: data.delegation,
      });
      await refreshDelegations();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingDelegation(false);
    }
  };

  const handleRevokeOrEnable = async (d: DelegationRecord) => {
    if (!d.full) return;
    const action = d.disabled ? "ENABLE_DELEGATION" : "REVOKE_DELEGATION";
    const setLoading = d.disabled ? setEnablingHash : setRevokingHash;
    setLoading(d.hash);
    setActionErrors((prev) => ({ ...prev, [d.hash]: "" }));
    try {
      const res = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, delegation: d.full }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDelegations((prev) =>
        prev.map((x) => (x.hash === d.hash ? { ...x, disabled: !d.disabled } : x))
      );
      setLastCreated((prev) =>
        prev && prev.hash === d.hash ? { ...prev, disabled: !d.disabled } : prev
      );
    } catch (e) {
      setActionErrors((prev) => ({
        ...prev,
        [d.hash]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* ── Left column ── */}
      <div className="space-y-5">
        <DelegationKit
          onWalletChange={setConnectedWallet}
          defaultDestination={smartWalletAddress ?? undefined}
        />

        {/* On-chain delegation card */}
        <Card>
          <CardHeader title="On-Chain Delegation" />
          <CardBody className="space-y-3 pt-4">
            {!smartWalletAddress ? (
              <div>
                <p className="mb-2 text-xs text-text-muted">
                  {walletOwner
                    ? "Deploy a smart wallet to create on-chain delegations."
                    : "Connect your Freighter wallet above, then deploy a smart wallet to create on-chain delegations."}
                </p>
                <button
                  onClick={handleDeployWallet}
                  disabled={deployingWallet || !walletOwner}
                  className={BUTTON_CLS}
                >
                  {deployingWallet ? (
                    <>
                      <Spinner /> Deploying…
                    </>
                  ) : (
                    "Deploy Smart Wallet"
                  )}
                </button>
                {deployError && (
                  <div className="mt-3 rounded-xl border border-error/15 bg-error/6 px-4 py-3">
                    <p className="text-xs text-error/90">{deployError}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl bg-bg-elevated p-3">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
                    Smart Wallet
                  </p>
                  <p className="mt-1 font-mono text-xs text-text-primary">
                    {smartWalletAddress}
                  </p>
                  <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
                      Balance
                    </span>
                    <span className="flex items-center gap-2 font-mono text-xs text-text-secondary">
                      {smartWalletBalance !== null
                        ? `${smartWalletBalance} XLM`
                        : "—"}
                      <button
                        onClick={() => checkSmartWalletBalance(smartWalletAddress)}
                        className="rounded text-accent transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                      >
                        Refresh
                      </button>
                    </span>
                  </div>
                </div>

                {/* Delegate: who can redeem this delegation */}
                <div className="space-y-2.5 rounded-xl bg-bg-elevated p-3">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
                    Delegate
                  </p>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setDelegateMode("smart-wallet")}
                      className={`flex-1 rounded-lg border px-3 py-1.5 transition-colors ${
                        delegateMode === "smart-wallet"
                          ? "border-accent/40 bg-accent/10 text-text-primary"
                          : "border-white/5 text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      This wallet
                    </button>
                    <button
                      type="button"
                      onClick={() => setDelegateMode("agent")}
                      className={`flex-1 rounded-lg border px-3 py-1.5 transition-colors ${
                        delegateMode === "agent"
                          ? "border-accent/40 bg-accent/10 text-text-primary"
                          : "border-white/5 text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      AI agent
                    </button>
                  </div>
                  {delegateMode === "agent" && (
                    <div>
                      <input
                        type="text"
                        placeholder="Agent public key (G...)"
                        value={agentPubkey}
                        onChange={(e) => setAgentPubkey(e.target.value.trim())}
                        className={INPUT_CLS}
                      />
                      <p className="mt-1 text-[11px] text-text-muted">
                        Run <code>kairos-mcp-agent-keygen</code> where your agent runs and paste
                        its public key here. The agent only ever holds this ephemeral key —
                        scope what it can do with the policies below.
                      </p>
                    </div>
                  )}
                </div>

                {/* Policy (caveat) builder */}
                <div className="space-y-2.5 rounded-xl bg-bg-elevated p-3">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
                    Policies
                  </p>

                  <label className="flex items-center gap-2 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={targetWhitelistEnabled}
                      onChange={(e) => setTargetWhitelistEnabled(e.target.checked)}
                      className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                    />
                    Target whitelist
                  </label>
                  {targetWhitelistEnabled && (
                    <div>
                      <input
                        type="text"
                        placeholder="Allowed target address (G... or C...)"
                        value={targetWhitelistAddress}
                        onChange={(e) => setTargetWhitelistAddress(e.target.value)}
                        className={INPUT_CLS}
                      />
                      <p className="mt-1 text-[11px] text-text-muted">
                        Contract or account address this delegation is restricted to calling.
                      </p>
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={spendLimitEnabled}
                      onChange={(e) => setSpendLimitEnabled(e.target.checked)}
                      className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                    />
                    Spend limit
                  </label>
                  {spendLimitEnabled && (
                    <div>
                      <input
                        type="text"
                        placeholder="Token (default: XLM)"
                        value={spendLimitToken}
                        onChange={(e) => setSpendLimitToken(e.target.value)}
                        className={`${INPUT_CLS} mb-2`}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Limit (stroops)"
                          value={spendLimitAmount}
                          onChange={(e) => setSpendLimitAmount(e.target.value)}
                          className={INPUT_CLS}
                        />
                        <input
                          type="text"
                          placeholder="Period (s)"
                          value={spendLimitPeriod}
                          onChange={(e) => setSpendLimitPeriod(e.target.value)}
                          className={INPUT_CLS}
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-text-muted">
                        1 XLM = 10,000,000 stroops
                        {spendLimitAmount && !Number.isNaN(Number(spendLimitAmount)) && (
                          <> · ≈ {(Number(spendLimitAmount) / 1e7).toFixed(2)} XLM</>
                        )}
                        {" · "}Period is a rolling window in seconds (86400 = 1 day).
                      </p>
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={timeRestrictionEnabled}
                      onChange={(e) => setTimeRestrictionEnabled(e.target.checked)}
                      className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                    />
                    Time restriction
                  </label>
                  {timeRestrictionEnabled && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-muted">
                          Start
                        </label>
                        <input
                          type="datetime-local"
                          value={timeStart}
                          onChange={(e) => setTimeStart(e.target.value)}
                          className={INPUT_CLS}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-muted">
                          Expiry
                        </label>
                        <input
                          type="datetime-local"
                          value={timeExpiry}
                          onChange={(e) => setTimeExpiry(e.target.value)}
                          className={INPUT_CLS}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={handleCreateDelegation}
                  disabled={creatingDelegation}
                  className={BUTTON_CLS}
                >
                  {creatingDelegation ? (
                    <>
                      <Spinner /> Creating…
                    </>
                  ) : (
                    "Create Delegation"
                  )}
                </button>

                {createError && (
                  <div className="rounded-xl border border-error/15 bg-error/6 px-4 py-3">
                    <p className="text-xs text-error/90">{createError}</p>
                  </div>
                )}

                {lastCreated && (
                  <div className="rounded-xl border border-success/20 bg-success/10 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-success">
                        Delegation Hash
                      </p>
                      <Badge tone={lastCreated.disabled ? "error" : "success"} dot>
                        {lastCreated.disabled ? "Disabled" : "Active"}
                      </Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-success">
                      {lastCreated.hash}
                    </p>
                    {lastCreated.full && lastCreated.full.caveats.length > 0 && (
                      <ul className="mt-2 space-y-0.5 border-t border-success/20 pt-2">
                        {lastCreated.full.caveats.map((c, i) => (
                          <li key={i} className="text-[11px] text-success/80">
                            {describeCaveat(c.terms)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {lastCreated?.full && delegateMode === "agent" && (
                  <div className="rounded-xl border border-white/5 bg-bg-elevated p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
                        Export for agent
                      </p>
                      <button
                        onClick={async () => {
                          await navigator.clipboard.writeText(
                            JSON.stringify(lastCreated.full, null, 2)
                          );
                          setCopiedExport(true);
                          setTimeout(() => setCopiedExport(false), 2000);
                        }}
                        className="rounded text-xs text-accent transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                      >
                        {copiedExport ? "Copied!" : "Copy JSON"}
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-text-muted">
                      Save this as <code>~/.kairos/delegations/{lastCreated.hash}.json</code>{" "}
                      where your MCP agent runs.
                    </p>
                    <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/30 p-2 font-mono text-[10px] text-text-secondary">
                      {JSON.stringify(lastCreated.full, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ── Right column: active delegations ── */}
      <Card>
        <CardHeader
          title="Active Delegations"
          action={
            <button
              onClick={refreshDelegations}
              disabled={delegationsLoading}
              className="rounded text-xs text-text-muted transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-40"
            >
              {delegationsLoading ? "Refreshing…" : "Refresh"}
            </button>
          }
        />
        <CardBody className="pt-4">
          {delegationsError && (
            <div className="mb-3 rounded-xl border border-error/15 bg-error/6 px-4 py-3">
              <p className="text-xs text-error/90">{delegationsError}</p>
            </div>
          )}

          {delegationsLoading && delegations.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-xl bg-bg-elevated/60"
                />
              ))}
            </div>
          ) : delegations.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              No delegations yet — create one from the panel on the left.
            </p>
          ) : (
            <div className="space-y-2">
              {delegations.map((d) => (
                <div key={d.hash}>
                  <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-mono text-xs text-text-primary">
                        {shortHash(d.hash)}
                      </p>
                      <Badge tone={d.disabled ? "error" : "success"} dot>
                        {d.disabled ? "Disabled" : "Active"}
                      </Badge>
                      {d.full && (
                        <div className="pt-1 text-[11px] text-text-secondary">
                          <p className="font-mono">
                            Delegate: {d.full.delegate.slice(0, 6)}…{d.full.delegate.slice(-4)}
                          </p>
                          {d.full.caveats.length === 0 ? (
                            <p className="text-text-muted">No policies (unrestricted)</p>
                          ) : (
                            <ul className="mt-0.5 space-y-0.5">
                              {d.full.caveats.map((c, i) => (
                                <li key={i} className="text-text-muted">
                                  {describeCaveat(c.terms)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRevokeOrEnable(d)}
                      disabled={
                        !d.full || revokingHash === d.hash || enablingHash === d.hash
                      }
                      title={
                        !d.full
                          ? "Full delegation data for this hash isn't available on this device — only delegations created or previously loaded here can be revoked or enabled."
                          : undefined
                      }
                      className="ml-3 inline-flex shrink-0 min-w-[72px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-white/5 bg-bg-elevated px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {revokingHash === d.hash || enablingHash === d.hash ? (
                        <Spinner className="h-3 w-3" />
                      ) : d.disabled ? (
                        "Enable"
                      ) : (
                        "Revoke"
                      )}
                    </button>
                  </div>
                  {actionErrors[d.hash] && (
                    <p className="mt-1 px-1 text-[11px] text-error/90">
                      {actionErrors[d.hash]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="mt-4 text-[11px] text-text-muted">
            Delegations you&apos;ve created or revoked/enabled are remembered on this device and
            restored automatically when you reconnect. Revoke/Enable only work for delegations
            known on this device — one created elsewhere and never touched here won&apos;t have
            its full data available locally.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
