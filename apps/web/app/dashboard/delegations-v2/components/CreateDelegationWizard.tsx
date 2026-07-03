"use client";

import { useState, useCallback, useEffect } from "react";
import { Address, Asset, StrKey } from "@stellar/stellar-sdk";
import { Spinner } from "@/app/components/ui/Spinner";

type DelegateType = "self" | "agent" | "manual";

interface WizardState {
  step: number;
  delegateType: DelegateType;
  delegateAddress: string;
  assets: { symbol: string; amount: number }[];
  permissions: string[];
  limits: {
    dailyLimit: string;
    perTxLimit: string;
    slippage: string;
    expiration: string;
    cooldown: string;
    spendingCap: string;
  };
  policies: {
    targetWhitelist: { enabled: boolean; address: string };
    spendLimit: { enabled: boolean; token: string; amount: string; period: string };
    timeRestriction: { enabled: boolean; start: string; expiry: string };
  };
}

const INITIAL_STATE: WizardState = {
  step: 1,
  delegateType: "self",
  delegateAddress: "",
  assets: [{ symbol: "XLM", amount: 0 }],
  permissions: [],
  limits: {
    dailyLimit: "1000",
    perTxLimit: "500",
    slippage: "1",
    expiration: "",
    cooldown: "0",
    spendingCap: "10000",
  },
  policies: {
    targetWhitelist: { enabled: false, address: "" },
    spendLimit: { enabled: false, token: "", amount: "", period: "86400" },
    timeRestriction: { enabled: false, start: "", expiry: "" },
  },
};

const STEPS = [
  { num: 1, label: "Delegate" },
  { num: 2, label: "Assets" },
  { num: 3, label: "Permissions" },
  { num: 4, label: "Limits" },
  { num: 5, label: "Policies" },
  { num: 6, label: "Review" },
  { num: 7, label: "Confirm" },
];

const PERMISSION_OPTIONS = [
  { id: "swap", label: "Swap", desc: "Execute token swaps and trades" },
  { id: "deposit", label: "Deposit", desc: "Deposit assets into protocols" },
  { id: "withdraw", label: "Withdraw Rewards", desc: "Claim staking/liquidity rewards" },
  { id: "stake", label: "Stake", desc: "Stake assets for yield" },
  { id: "execute", label: "Execute", desc: "Execute smart contract calls" },
  { id: "borrow", label: "Borrow", desc: "Borrow against collateral" },
  { id: "transfer", label: "Transfer Ownership", desc: "Transfer wallet ownership" },
  { id: "upgrade", label: "Upgrade Policies", desc: "Modify delegation policies" },
  { id: "bridge", label: "Bridge", desc: "Bridge assets between chains" },
];

export function CreateDelegationWizard({
  open,
  smartWalletAddress,
  networkPassphrase,
  onCreate,
  onClose,
}: {
  open: boolean;
  smartWalletAddress: string | null;
  networkPassphrase: string;
  onCreate: (delegate: string, policies: Record<string, unknown>[]) => Promise<string>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<WizardState>(INITIAL_STATE);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdHash, setCreatedHash] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState<string | null>(null);

  const update = useCallback(<K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateNested = useCallback(
    <K extends keyof WizardState>(parent: K, field: string, value: unknown) => {
      setForm((prev) => ({
        ...prev,
        [parent]: { ...(prev[parent] as object), [field]: value },
      }));
    },
    []
  );

  const goTo = useCallback((step: number) => {
    setForm((prev) => ({ ...prev, step }));
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setForm(INITIAL_STATE);
    setCreating(false);
    setError(null);
    setCreatedHash(null);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        reset();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, reset]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const togglePermission = useCallback((id: string) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(id)
        ? prev.permissions.filter((p) => p !== id)
        : [...prev.permissions, id],
    }));
  }, []);

  const delegateAddressError = useCallback((): string | null => {
    const addr = form.delegateAddress.trim();
    if (!addr && form.delegateType !== "self") return "Address is required";
    if (addr && !StrKey.isValidEd25519PublicKey(addr)) return "Invalid Stellar public key (G...)";
    return null;
  }, [form.delegateAddress, form.delegateType]);

  const canProceed = useCallback((): boolean => {
    switch (form.step) {
      case 1:
        if (form.delegateType === "self") return !!smartWalletAddress;
        return !!form.delegateAddress.trim() && !delegateAddressError();
      case 2:
        return form.assets.some((a) => a.amount > 0);
      case 3:
        return form.permissions.length > 0;
      case 4:
        return true;
      case 5:
        return true;
      case 6:
        return true;
      default:
        return true;
    }
  }, [form, smartWalletAddress, delegateAddressError]);

  const handleNext = useCallback(() => {
    if (form.step < 7) goTo(form.step + 1);
  }, [form.step, goTo]);

  const handleBack = useCallback(() => {
    if (form.step > 1) goTo(form.step - 1);
  }, [form.step, goTo]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const delegate =
        form.delegateType === "self"
          ? smartWalletAddress!
          : form.delegateAddress.trim();

      const policies: Record<string, unknown>[] = [];
      const p = form.policies;

      if (p.targetWhitelist.enabled && p.targetWhitelist.address) {
        policies.push({ type: "target-whitelist", target: p.targetWhitelist.address });
      }

      if (p.spendLimit.enabled && p.spendLimit.amount) {
        policies.push({
          type: "spend-limit",
          token: p.spendLimit.token || Asset.native().contractId(networkPassphrase),
          spendLimit: p.spendLimit.amount,
          period: p.spendLimit.period,
        });
      }

      if (p.timeRestriction.enabled && p.timeRestriction.start && p.timeRestriction.expiry) {
        policies.push({
          type: "time-restriction",
          start: Math.floor(new Date(p.timeRestriction.start).getTime() / 1000).toString(),
          expiry: Math.floor(new Date(p.timeRestriction.expiry).getTime() / 1000).toString(),
        });
      }

      const hash = await onCreate(delegate, policies);
      setCreatedHash(hash);
      goTo(7);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [form, smartWalletAddress, networkPassphrase, onCreate, goTo]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-bg-primary border border-white/5 rounded-2xl shadow-2xl animate-fade-in-up">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/5 bg-bg-primary/90 backdrop-blur-sm px-6 py-4">
          <div>
            <h2 className="font-display text-sm font-medium text-text-primary">
              Create Delegation
            </h2>
            <p className="mt-0.5 text-[11px] text-text-muted">
              Step {form.step} of 7 — {STEPS[form.step - 1].label}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-text-muted hover:text-text-secondary hover:bg-white/[0.04] transition-colors cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1 px-6 pt-5 pb-2">
          {STEPS.map((s) => (
            <div key={s.num} className="flex items-center gap-1 flex-1">
              <button
                onClick={() => s.num < form.step && goTo(s.num)}
                disabled={s.num >= form.step}
                className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-mono font-medium transition-all duration-300 cursor-pointer disabled:cursor-default ${
                  s.num < form.step
                    ? "bg-accent text-white"
                    : s.num === form.step
                      ? "bg-accent/20 text-accent border border-accent/30"
                      : "bg-bg-elevated/50 text-text-muted border border-white/5"
                }`}
              >
                {s.num < form.step ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  s.num
                )}
              </button>
              <div
                className={`h-px flex-1 transition-colors duration-300 ${
                  s.num <= form.step ? "bg-accent/40" : "bg-white/5"
                }`}
              />
            </div>
          ))}
        </div>

        {/* Step labels */}
        <div className="flex items-center justify-between px-6 pb-4">
          {STEPS.map((s) => (
            <span
              key={s.num}
              className={`text-[9px] font-mono uppercase tracking-wider transition-colors duration-300 ${
                s.num === form.step
                  ? "text-accent"
                  : s.num < form.step
                    ? "text-text-secondary"
                    : "text-text-muted/40"
              }`}
            >
              {s.label}
            </span>
          ))}
        </div>

        {/* Step Content with animation */}
        <div className="px-6 pb-6">
          <div key={form.step} className="animate-fade-in-up">
            {form.step === 1 && (
              <Step1Delegate
                form={form}
                smartWalletAddress={smartWalletAddress}
                delegateAddressError={delegateAddressError}
                updateNested={updateNested}
                update={update}
              />
            )}
            {form.step === 2 && (
              <Step2Assets form={form} updateNested={updateNested} />
            )}
            {form.step === 3 && (
              <Step3Permissions
                selected={form.permissions}
                onToggle={togglePermission}
                showTooltip={showTooltip}
                onShowTooltip={setShowTooltip}
              />
            )}
            {form.step === 4 && (
              <Step4Limits form={form} updateNested={updateNested} />
            )}
            {form.step === 5 && (
              <Step5Policies form={form} updateNested={updateNested} />
            )}
            {form.step === 6 && (
              <Step6Review
                form={form}
                smartWalletAddress={smartWalletAddress}
              />
            )}
            {form.step === 7 && (
              <Step7Confirmation
                hash={createdHash}
                error={error}
                creating={false}
                onDone={handleClose}
                onRetry={handleCreate}
              />
            )}
          </div>

          {/* Error */}
          {error && form.step !== 7 && (
            <div className="mt-4 rounded-xl border border-error/15 bg-error/6 px-4 py-3">
              <p className="text-xs text-error/90">{error}</p>
            </div>
          )}

          {/* Navigation */}
          {form.step < 7 && (
            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                onClick={handleBack}
                disabled={form.step === 1}
                className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-2.5 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
              >
                Back
              </button>

              {form.step < 6 ? (
                <button
                  onClick={handleNext}
                  disabled={!canProceed()}
                  className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Continue
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 inline-flex items-center gap-2"
                >
                  {creating ? (
                    <>
                      <Spinner />
                      Creating...
                    </>
                  ) : (
                    "Create Delegation"
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────── Step 1: Delegate Selection ──────────────────────────────

function Step1Delegate({
  form,
  smartWalletAddress,
  delegateAddressError,
  updateNested,
  update,
}: {
  form: WizardState;
  smartWalletAddress: string | null;
  delegateAddressError: () => string | null;
  updateNested: (parent: keyof WizardState, field: string, value: unknown) => void;
  update: (key: keyof WizardState, value: WizardState[keyof WizardState]) => void;
}) {
  const addrErr = form.delegateType !== "self" ? delegateAddressError() : null;

  return (
    <div className="space-y-5">
      <p className="text-xs text-text-muted">
        Choose who or what will execute trades on your behalf.
      </p>

      <div className="grid grid-cols-3 gap-3">
        {[
          { id: "self" as const, label: "Smart Wallet", desc: "Delegate to your own smart wallet", icon: "W" },
          { id: "agent" as const, label: "AI Agent", desc: "Ephemeral agent session key", icon: "A" },
          { id: "manual" as const, label: "Manual Address", desc: "Any Stellar G address", icon: "M" },
        ].map((opt) => (
          <button
            key={opt.id}
            onClick={() => {
              update("delegateType", opt.id);
              if (opt.id === "self") updateNested("limits" as keyof WizardState, "delegateAddress", "");
            }}
            className={`rounded-xl border p-4 text-left transition-all duration-200 cursor-pointer ${
              form.delegateType === opt.id
                ? "border-accent/30 bg-accent-muted/30"
                : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.03]"
            }`}
          >
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-mono font-bold ${
                form.delegateType === opt.id
                  ? "bg-accent/20 text-accent"
                  : "bg-bg-elevated/60 text-text-muted"
              }`}
            >
              {opt.icon}
            </div>
            <p className="mt-2 text-xs font-medium text-text-primary">{opt.label}</p>
            <p className="mt-0.5 text-[10px] text-text-muted">{opt.desc}</p>
          </button>
        ))}
      </div>

      {form.delegateType === "self" && (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <p className="text-xs text-text-secondary">
            Smart wallet:{" "}
            <span className="font-mono text-text-primary">
              {smartWalletAddress ? `${smartWalletAddress.slice(0, 8)}...${smartWalletAddress.slice(-4)}` : "Not deployed"}
            </span>
          </p>
          {!smartWalletAddress && (
            <p className="mt-1.5 text-[11px] text-amber-400/80">
              Deploy a smart wallet first to use self-delegation.
            </p>
          )}
        </div>
      )}

      {(form.delegateType === "agent" || form.delegateType === "manual") && (
        <div>
          <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
            {form.delegateType === "agent" ? "Agent Public Key" : "Delegate Address"}
          </label>
          <input
            type="text"
            placeholder="G..."
            value={form.delegateAddress}
            onChange={(e) => updateNested("limits" as keyof WizardState, "delegateAddress", e.target.value)}
            className={`w-full rounded-xl border bg-white/[0.02] px-4 py-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted/50 transition-all duration-300 focus:outline-none focus:ring-2 ${
              addrErr
                ? "border-error/30 focus:border-error/30 focus:ring-error/15"
                : "border-white/5 focus:border-accent/30 focus:ring-accent/15"
            }`}
          />
          {addrErr && <p className="mt-1.5 text-[11px] text-error/80">{addrErr}</p>}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────── Step 2: Assets ──────────────────────────────

function Step2Assets({
  form,
  updateNested,
}: {
  form: WizardState;
  updateNested: (parent: keyof WizardState, field: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-text-muted">
        Select assets and amounts to delegate.
      </p>

      {form.assets.map((asset, i) => (
        <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/15 text-amber-400 font-mono text-xs font-bold">
                {asset.symbol.slice(0, 2)}
              </div>
              <span className="font-mono text-sm font-medium text-text-primary">{asset.symbol}</span>
            </div>
            {asset.amount > 0 && (
              <span className="font-mono text-xs text-text-secondary">
                ${(asset.amount * 0.12).toFixed(2)} USD
              </span>
            )}
          </div>

          <div className="relative">
            <input
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={asset.amount || ""}
              onChange={(e) => {
                const newAssets = [...form.assets];
                newAssets[i] = { ...newAssets[i], amount: parseFloat(e.target.value) || 0 };
                updateNested("limits" as keyof WizardState, "assets", newAssets);
              }}
              className="w-full rounded-lg border border-white/5 bg-bg-elevated px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted/50 transition-all duration-200 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
            />
          </div>

          <div className="mt-2 flex gap-2">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                onClick={() => {
                  const newAssets = [...form.assets];
                  newAssets[i] = { ...newAssets[i], amount: 10000 * (pct / 100) };
                  updateNested("limits" as keyof WizardState, "assets", newAssets);
                }}
                className="flex-1 rounded-lg border border-white/5 bg-white/[0.02] py-1.5 text-[11px] font-mono text-text-muted hover:bg-white/[0.05] hover:text-text-secondary transition-all duration-200 cursor-pointer"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────── Step 3: Permissions ──────────────────────────────

function Step3Permissions({
  selected,
  onToggle,
  showTooltip,
  onShowTooltip,
}: {
  selected: string[];
  onToggle: (id: string) => void;
  showTooltip: string | null;
  onShowTooltip: (id: string | null) => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-text-muted">
        Select the actions the delegate is allowed to perform.
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PERMISSION_OPTIONS.map((perm) => {
          const isSelected = selected.includes(perm.id);
          return (
            <div
              key={perm.id}
              className="relative"
              onMouseEnter={() => onShowTooltip(perm.id)}
              onMouseLeave={() => onShowTooltip(null)}
            >
              <button
                onClick={() => onToggle(perm.id)}
                className={`w-full rounded-xl border p-3 text-left transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? "border-accent/30 bg-accent-muted/30"
                    : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.03]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-text-primary">{perm.label}</span>
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded border transition-all duration-200 ${
                      isSelected
                        ? "border-accent bg-accent text-white scale-100"
                        : "border-white/10 bg-transparent scale-90"
                    }`}
                  >
                    {isSelected && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="animate-fade-in-up">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-[10px] text-text-muted">{perm.desc}</p>
              </button>

              {showTooltip === perm.id && (
                <div className="absolute -top-1 right-0 translate-y-[-100%] z-20 rounded-lg border border-white/5 bg-bg-elevated px-3 py-2 text-[10px] text-text-secondary shadow-xl whitespace-nowrap">
                  {perm.desc}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
        <span className="text-xs text-text-muted">
          {selected.length} of {PERMISSION_OPTIONS.length} selected
        </span>
        {selected.length > 0 && (
          <button
            onClick={() => selected.forEach(onToggle)}
            className="text-[11px] text-accent hover:text-accent-hover transition-colors cursor-pointer"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────── Step 4: Limits ──────────────────────────────

function Step4Limits({
  form,
  updateNested,
}: {
  form: WizardState;
  updateNested: (parent: keyof WizardState, field: string, value: unknown) => void;
}) {
  const limits = form.limits;

  return (
    <div className="space-y-5">
      <p className="text-xs text-text-muted">
        Set execution limits and safeguards for the delegation.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <NumberField
          label="Daily Limit ($)"
          value={limits.dailyLimit}
          onChange={(v) => updateNested("limits" as keyof WizardState, "dailyLimit", v)}
          placeholder="1000"
        />
        <NumberField
          label="Per-Tx Limit ($)"
          value={limits.perTxLimit}
          onChange={(v) => updateNested("limits" as keyof WizardState, "perTxLimit", v)}
          placeholder="500"
        />
        <NumberField
          label="Max Slippage (%)"
          value={limits.slippage}
          onChange={(v) => updateNested("limits" as keyof WizardState, "slippage", v)}
          placeholder="1"
          step="0.1"
        />
        <NumberField
          label="Cooldown (seconds)"
          value={limits.cooldown}
          onChange={(v) => updateNested("limits" as keyof WizardState, "cooldown", v)}
          placeholder="0"
        />
        <NumberField
          label="Spending Cap ($)"
          value={limits.spendingCap}
          onChange={(v) => updateNested("limits" as keyof WizardState, "spendingCap", v)}
          placeholder="10000"
        />
        <div>
          <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
            Expiration
          </label>
          <input
            type="datetime-local"
            value={limits.expiration}
            onChange={(e) => updateNested("limits" as keyof WizardState, "expiration", e.target.value)}
            className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5 font-mono text-xs text-text-primary transition-all duration-300 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
          />
        </div>
      </div>

      <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.05] px-4 py-3">
        <p className="text-[11px] text-amber-300/85">
          Limits are enforced by on-chain policy caveats. Exceeding any limit will cause the
          transaction to revert.
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────── Step 5: Policies ──────────────────────────────

function Step5Policies({
  form,
  updateNested,
}: {
  form: WizardState;
  updateNested: (parent: keyof WizardState, field: string, value: unknown) => void;
}) {
  const p = form.policies;

  const toUnix = (local: string): string => {
    if (!local) return "";
    return Math.floor(new Date(local).getTime() / 1000).toString();
  };

  return (
    <div className="space-y-5">
      <p className="text-xs text-text-muted">
        Attach caveats to restrict how the delegation can be used.
      </p>

      {/* Target Whitelist */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <div
            className={`flex h-5 w-5 items-center justify-center rounded border transition-all duration-200 ${
              p.targetWhitelist.enabled
                ? "border-accent bg-accent text-white"
                : "border-white/10 bg-transparent"
            }`}
            onClick={() =>
              updateNested("policies" as keyof WizardState, "targetWhitelist", {
                ...p.targetWhitelist,
                enabled: !p.targetWhitelist.enabled,
              })
            }
          >
            {p.targetWhitelist.enabled && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <div>
            <span className="text-xs font-medium text-text-primary">Target Whitelist</span>
            <p className="text-[10px] text-text-muted">
              Restrict which contract or account addresses can be called
            </p>
          </div>
        </label>
        {p.targetWhitelist.enabled && (
          <div className="mt-3">
            <input
              type="text"
              placeholder="Allowed target address (G...)"
              value={p.targetWhitelist.address}
              onChange={(e) =>
                updateNested("policies" as keyof WizardState, "targetWhitelist", {
                  ...p.targetWhitelist,
                  address: e.target.value,
                })
              }
              className="w-full rounded-lg border border-white/5 bg-bg-elevated px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted/50 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15 transition-all duration-200"
            />
          </div>
        )}
      </div>

      {/* Spend Limit */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <div
            className={`flex h-5 w-5 items-center justify-center rounded border transition-all duration-200 ${
              p.spendLimit.enabled
                ? "border-accent bg-accent text-white"
                : "border-white/10 bg-transparent"
            }`}
            onClick={() =>
              updateNested("policies" as keyof WizardState, "spendLimit", {
                ...p.spendLimit,
                enabled: !p.spendLimit.enabled,
              })
            }
          >
            {p.spendLimit.enabled && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <div>
            <span className="text-xs font-medium text-text-primary">Spend Limit</span>
            <p className="text-[10px] text-text-muted">
              Cap total spend over a rolling time window
            </p>
          </div>
        </label>
        {p.spendLimit.enabled && (
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Token
              </label>
              <input
                type="text"
                placeholder="XLM (default)"
                value={p.spendLimit.token}
                onChange={(e) =>
                  updateNested("policies" as keyof WizardState, "spendLimit", {
                    ...p.spendLimit,
                    token: e.target.value,
                  })
                }
                className="w-full rounded-lg border border-white/5 bg-bg-elevated px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted/50 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15 transition-all duration-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Amount (stroops)
              </label>
              <input
                type="text"
                placeholder="10000000"
                value={p.spendLimit.amount}
                onChange={(e) =>
                  updateNested("policies" as keyof WizardState, "spendLimit", {
                    ...p.spendLimit,
                    amount: e.target.value,
                  })
                }
                className="w-full rounded-lg border border-white/5 bg-bg-elevated px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted/50 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15 transition-all duration-200"
              />
              {p.spendLimit.amount && !Number.isNaN(Number(p.spendLimit.amount)) && (
                <p className="mt-1 text-[10px] text-text-muted">
                  ≈ {(Number(p.spendLimit.amount) / 1e7).toFixed(2)} XLM
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Period (s)
              </label>
              <input
                type="text"
                placeholder="86400"
                value={p.spendLimit.period}
                onChange={(e) =>
                  updateNested("policies" as keyof WizardState, "spendLimit", {
                    ...p.spendLimit,
                    period: e.target.value,
                  })
                }
                className="w-full rounded-lg border border-white/5 bg-bg-elevated px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted/50 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15 transition-all duration-200"
              />
            </div>
          </div>
        )}
      </div>

      {/* Time Restriction */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <div
            className={`flex h-5 w-5 items-center justify-center rounded border transition-all duration-200 ${
              p.timeRestriction.enabled
                ? "border-accent bg-accent text-white"
                : "border-white/10 bg-transparent"
            }`}
            onClick={() =>
              updateNested("policies" as keyof WizardState, "timeRestriction", {
                ...p.timeRestriction,
                enabled: !p.timeRestriction.enabled,
              })
            }
          >
            {p.timeRestriction.enabled && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <div>
            <span className="text-xs font-medium text-text-primary">Time Restriction</span>
            <p className="text-[10px] text-text-muted">
              Limit execution to a specific date/time window
            </p>
          </div>
        </label>
        {p.timeRestriction.enabled && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Start
              </label>
              <input
                type="datetime-local"
                value={p.timeRestriction.start}
                onChange={(e) =>
                  updateNested("policies" as keyof WizardState, "timeRestriction", {
                    ...p.timeRestriction,
                    start: e.target.value,
                  })
                }
                className="w-full rounded-lg border border-white/5 bg-bg-elevated px-3 py-2 font-mono text-xs text-text-primary transition-all duration-200 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Expiry
              </label>
              <input
                type="datetime-local"
                value={p.timeRestriction.expiry}
                onChange={(e) =>
                  updateNested("policies" as keyof WizardState, "timeRestriction", {
                    ...p.timeRestriction,
                    expiry: e.target.value,
                  })
                }
                className="w-full rounded-lg border border-white/5 bg-bg-elevated px-3 py-2 font-mono text-xs text-text-primary transition-all duration-200 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────── Step 6: Review ──────────────────────────────

function Step6Review({
  form,
  smartWalletAddress,
}: {
  form: WizardState;
  smartWalletAddress: string | null;
}) {
  const delegateAddr =
    form.delegateType === "self"
      ? smartWalletAddress || "—"
      : form.delegateAddress || "—";

  const activePolicies: string[] = [
    form.policies.targetWhitelist.enabled ? "Target Whitelist" : null,
    form.policies.spendLimit.enabled ? "Spend Limit" : null,
    form.policies.timeRestriction.enabled ? "Time Restriction" : null,
  ].filter((s): s is string => s !== null);

  return (
    <div className="space-y-5">
      <p className="text-xs text-text-muted">
        Review your delegation configuration before creating it on-chain.
      </p>

      <ReviewSection title="Delegate">
        <ReviewRow label="Type" value={form.delegateType === "self" ? "Smart Wallet" : form.delegateType === "agent" ? "AI Agent" : "Manual"} />
        <ReviewRow label="Address" value={delegateAddr} mono />
      </ReviewSection>

      <ReviewSection title="Assets">
        {form.assets.filter((a) => a.amount > 0).length > 0 ? (
          form.assets
            .filter((a) => a.amount > 0)
            .map((a, i) => <ReviewRow key={i} label={a.symbol} value={`${a.amount.toLocaleString()} (≈ $${(a.amount * 0.12).toFixed(2)})`} />)
        ) : (
          <p className="text-[11px] text-text-muted">No assets selected</p>
        )}
      </ReviewSection>

      <ReviewSection title="Permissions">
        {form.permissions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {form.permissions.map((id) => {
              const opt = PERMISSION_OPTIONS.find((p) => p.id === id);
              return (
                <span key={id} className="rounded-full border border-white/5 bg-white/[0.02] px-2.5 py-0.5 text-[10px] text-text-secondary">
                  {opt?.label ?? id}
                </span>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-text-muted">None selected</p>
        )}
      </ReviewSection>

      <ReviewSection title="Limits">
        <ReviewRow label="Daily Limit" value={`$${form.limits.dailyLimit}`} />
        <ReviewRow label="Per-Tx Limit" value={`$${form.limits.perTxLimit}`} />
        <ReviewRow label="Slippage" value={`${form.limits.slippage}%`} />
        {form.limits.expiration && <ReviewRow label="Expires" value={new Date(form.limits.expiration).toLocaleString()} />}
      </ReviewSection>

      <ReviewSection title="Policies">
        {activePolicies.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {activePolicies.map((p) => (
              <span key={p} className="rounded-full border border-accent/10 bg-accent-muted/40 px-2.5 py-0.5 text-[10px] text-accent">
                {p}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-text-muted">None (unrestricted)</p>
        )}
      </ReviewSection>

      {!delegateAddr || delegateAddr === "—" ? (
        <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.05] px-4 py-3">
          <p className="text-[11px] text-amber-300/85">
            No delegate address configured. Go back to Step 1 and select or enter a delegate.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-accent/10 bg-accent-muted/30 px-4 py-3">
          <p className="text-[11px] text-accent/80">
            Estimated fee: <span className="font-mono font-medium">~0.001 XLM</span> for
            delegation creation. Actual fee may vary based on network conditions.
          </p>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────── Step 7: Confirmation ──────────────────────────────

function Step7Confirmation({
  hash,
  error,
  creating,
  onDone,
  onRetry,
}: {
  hash: string | null;
  error: string | null;
  creating: boolean;
  onDone: () => void;
  onRetry: () => void;
}) {
  if (creating) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Spinner />
        <p className="mt-4 text-sm text-text-secondary">Creating your delegation on-chain...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-error/10 mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <h3 className="font-display text-base font-medium text-text-primary">Creation Failed</h3>
        <p className="mt-2 max-w-sm text-xs text-text-muted">{error}</p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={onRetry}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover transition-colors cursor-pointer"
          >
            Try Again
          </button>
          <button
            onClick={onDone}
            className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {/* Success animation */}
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10 mb-4 animate-fade-in-up">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      </div>

      <h3 className="font-display text-base font-medium text-text-primary">Delegation Created!</h3>
      <p className="mt-1 text-xs text-text-muted">Your delegation has been created on-chain.</p>

      {hash && (
        <div className="mt-6 w-full max-w-md rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <p className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">Transaction Hash</p>
          <p className="font-mono text-xs text-text-primary break-all">{hash}</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(hash)}
              className="rounded-lg border border-white/5 bg-bg-elevated px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              Copy Hash
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 flex gap-3">
        <button
          onClick={onDone}
          className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover transition-colors cursor-pointer"
        >
          Done
        </button>
      </div>

      <p className="mt-6 text-[11px] text-text-muted">
        The delegation is active. You can revoke it anytime from the delegations list.
      </p>
    </div>
  );
}

// ────────────────────────────── Shared Helpers ──────────────────────────────

function NumberField({
  label,
  value,
  onChange,
  placeholder,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  step?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
        {label}
      </label>
      <input
        type="number"
        step={step || "1"}
        min="0"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted/50 transition-all duration-300 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
      />
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted mb-2">
        {title}
      </h3>
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-2">
        {children}
      </div>
    </div>
  );
}

function ReviewRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-text-muted">{label}</span>
      <span className={`text-[11px] ${mono ? "font-mono" : ""} text-text-secondary text-right max-w-[60%] truncate`}>
        {value}
      </span>
    </div>
  );
}
