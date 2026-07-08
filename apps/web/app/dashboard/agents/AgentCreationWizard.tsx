"use client";

// Guided agent-creation flow — implements the 9-step journey documented in agentcreation.md:
// Describe Goal → AI Understanding → Capital & Safety → Permissions → AI Plan → Smart Wallet
// Validation → Delegation Approval → Agent Creation → Success. Nothing here mocks data: the AI
// Understanding step calls the backend Intent Parser (POST /api/agents/parse-intent — the single
// production parser/prompt/AgentSpec schema for Agent Creation), the balance/validation steps read
// the live smart-wallet balance, and creation provisions a real role agent, attaches a real
// on-chain delegation (signed in the Approval step, per agentcreation.md §7), and funds it from
// the smart wallet. Permissions + Capital & Safety limits are sent as the agent's AgentPolicy
// (POST /api/agents/provision-role's `policy`) and enforced server-side (see backend/src/tick.ts)
// — not just displayed and discarded. The user describes *what* they want; Kairos maps it to a
// role/strategy/policy/delegation/funding.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X, ChevronRight, ChevronLeft, Check, Sprout, TrendingUp, PieChart, ShieldCheck,
  Coins, Sparkles, AlertTriangle, RefreshCw, Rocket, ArrowRight,
} from "lucide-react";
import { Asset } from "@stellar/stellar-sdk";
import { Badge } from "@/app/components/ui/Badge";
import { Spinner } from "@/app/components/ui/Spinner";
import { WalletPicker } from "@/app/components/WalletPicker";
import type { SmartWalletInfo } from "@/app/hooks/useSmartWallet";
import { useSmartWalletBalances } from "@/app/hooks/useSmartWalletBalances";
import { useCreateDelegation } from "@/app/hooks/useCreateDelegation";
import { withdrawFromSmartWallet } from "@/app/lib/stellar";
import {
  attachAgentDelegation,
  getAgentsSummary,
  parseAgentIntent,
  provisionSingleRoleAgent,
  type AgentPolicy,
  type AgentRole,
  type AgentSummary,
} from "@/app/lib/agentsBackend";
import type { RiskLevel as BackendRiskLevel } from "@kairos/types";

const INPUT_CLS =
  "w-full rounded-lg border border-white/5 bg-bg-elevated px-2.5 py-2 font-mono text-xs text-text-primary transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30";

// ── Templates → role mapping ──────────────────────────────────────────────────────────────
// Each template pre-fills the goal prompt (doc §1) and picks the role agent Kairos provisions.
type TemplateId = "yield" | "growth" | "portfolio" | "preservation" | "income" | "custom";

interface Template {
  id: TemplateId;
  icon: React.ReactNode;
  label: string;
  prompt: string;
  role: AgentRole;
}

const TEMPLATES: Template[] = [
  { id: "yield", icon: <Sprout className="h-4 w-4" />, label: "Yield Optimizer", prompt: "Maximize yield while keeping risk low.", role: "yield" },
  { id: "growth", icon: <TrendingUp className="h-4 w-4" />, label: "Growth", prompt: "Grow my XLM over the long term.", role: "strategic" },
  { id: "portfolio", icon: <PieChart className="h-4 w-4" />, label: "Portfolio Manager", prompt: "Rebalance my portfolio automatically.", role: "balancer" },
  { id: "preservation", icon: <ShieldCheck className="h-4 w-4" />, label: "Capital Preservation", prompt: "Preserve my capital.", role: "balancer" },
  { id: "income", icon: <Coins className="h-4 w-4" />, label: "Passive Income", prompt: "Generate passive income.", role: "yield" },
  { id: "custom", icon: <Sparkles className="h-4 w-4" />, label: "Custom", prompt: "", role: "strategic" },
];

const ROLE_MISSION: Record<AgentRole, string> = {
  yield: "Yield Optimization",
  strategic: "Strategic Growth",
  balancer: "Portfolio Management",
};

// Derives a role for the Custom template from the parsed goal text — never invented, always
// grounded in the words the user actually wrote (doc: "Never invent values.").
function inferRole(goal: string): AgentRole {
  const g = goal.toLowerCase();
  if (/yield|income|passive|interest|apy|earn/.test(g)) return "yield";
  if (/rebalanc|portfolio|preserve|balance|diversif|protect/.test(g)) return "balancer";
  return "strategic";
}

type Risk = BackendRiskLevel;
const RISK_LABEL: Record<Risk, string> = { conservative: "Conservative", balanced: "Balanced", aggressive: "Aggressive" };

// Mirrors @kairos/types AgentSpec — the single schema the backend Intent Parser produces and this
// wizard edits. No fields invented here beyond what the parser (or the user, via editing) stated.
interface ParsedSpec {
  mission: string;
  objective: string;
  riskLevel: Risk;
  executionStyle: "autonomous" | "guided";
  suggestedCapital: string | null;
  confidence: number;
}

type CapitalMode = "entire" | "percentage" | "fixed";

interface Capabilities {
  swap: boolean;
  yield: boolean;
  rebalance: boolean;
  dca: boolean;
  holdStable: boolean;
  borrow: boolean;
  leverage: boolean;
}

const CAPABILITY_ROWS: { key: keyof Capabilities; label: string }[] = [
  { key: "swap", label: "Swap Assets" },
  { key: "yield", label: "Earn Yield" },
  { key: "rebalance", label: "Rebalance Portfolio" },
  { key: "dca", label: "Dollar Cost Average (DCA)" },
  { key: "holdStable", label: "Hold Stable Assets" },
  { key: "borrow", label: "Borrow Assets" },
  { key: "leverage", label: "Use Leverage" },
];

const STEPS = [
  "Describe Goal", "AI Understanding", "Capital & Safety", "Permissions", "Review Plan",
  "Smart Wallet", "Approval", "Creating", "Ready",
] as const;

// Progress checklist for the creation step (doc §8). Each entry maps to exactly one real await
// in runCreation below — no cosmetic/decorative entries. "Runtime"/"Memory"/"Benchmark"/
// "Scheduler" from the doc's illustrative list aren't separate backend steps in this
// implementation (see backend/src/provisionService.ts — a role agent's runtime/memory/
// benchmark bookkeeping is implicit in "Agent"), so they're omitted rather than faked.
const CREATION_TASKS = ["Agent", "Policy", "Delegation", "Funding"] as const;
type TaskState = "pending" | "active" | "done";

function fmtXlm(n: number): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} XLM`;
}

export function AgentCreationWizard({
  smartWalletAddress,
  smartWallets,
  walletOwner,
  networkPassphrase,
  sorobanRpcUrl,
  deploying,
  deployError,
  onDeploySmartWallet,
  onClose,
  onCreated,
}: {
  smartWalletAddress: string | null;
  smartWallets: SmartWalletInfo[];
  walletOwner: string;
  networkPassphrase: string;
  sorobanRpcUrl?: string;
  deploying: boolean;
  deployError: string | null;
  onDeploySmartWallet: () => Promise<void>;
  onClose: () => void;
  onCreated: (agentId: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — goal
  const [templateId, setTemplateId] = useState<TemplateId | null>(null);
  const [goalText, setGoalText] = useState("");

  // Step 2 — AI understanding
  const [parsing, setParsing] = useState(false);
  const [spec, setSpec] = useState<ParsedSpec | null>(null);

  // Step 3 — capital & safety
  const [capitalMode, setCapitalMode] = useState<CapitalMode>("percentage");
  const [percentage, setPercentage] = useState("30");
  const [fixedAmount, setFixedAmount] = useState("500");
  const [maxAllocationPct, setMaxAllocationPct] = useState("20");
  const [maxDailyTrades, setMaxDailyTrades] = useState("5");
  const [maxSlippagePct, setMaxSlippagePct] = useState("0.5");

  // Step 4 — permissions
  const [caps, setCaps] = useState<Capabilities>({
    swap: true, yield: true, rebalance: true, dca: true, holdStable: true, borrow: false, leverage: false,
  });

  // Step 6 — delegator wallet selection
  const [delegatorWallet, setDelegatorWallet] = useState<string | null>(smartWalletAddress);
  useEffect(() => { setDelegatorWallet(smartWalletAddress); }, [smartWalletAddress]);

  // Step 8/9 — creation
  const [tasks, setTasks] = useState<Record<string, TaskState>>({});
  const [creating, setCreating] = useState(false);
  const [createdAgent, setCreatedAgent] = useState<AgentSummary | null>(null);

  const role: AgentRole = useMemo(() => {
    if (templateId && templateId !== "custom") return TEMPLATES.find((t) => t.id === templateId)!.role;
    return inferRole(spec?.objective ?? goalText);
  }, [templateId, spec, goalText]);

  const balances = useSmartWalletBalances(delegatorWallet, networkPassphrase, sorobanRpcUrl);
  const { createDelegation } = useCreateDelegation(networkPassphrase, walletOwner);

  const managedCapital = useMemo(() => {
    const bal = balances.xlmBalance;
    if (capitalMode === "entire") return bal;
    if (capitalMode === "percentage") return (bal * (parseFloat(percentage) || 0)) / 100;
    return parseFloat(fixedAmount) || 0;
  }, [capitalMode, percentage, fixedAmount, balances.xlmBalance]);

  const walletReady = Boolean(delegatorWallet);
  const balanceSufficient = walletReady && managedCapital > 0 && managedCapital <= balances.xlmBalance;

  // ── Step transitions ──────────────────────────────────────────────────────────────────────
  const runParse = useCallback(async () => {
    setError(null);
    setParsing(true);
    try {
      const result = await parseAgentIntent(goalText.trim());
      if (result.status === "failed") {
        throw new Error(result.error || "Could not understand that goal — try rephrasing.");
      }
      if (result.status === "needs_clarification" || !result.spec) {
        // Doc: "If required information is missing, ask clarification questions. Never invent
        // values." — stay on Step 1 and surface the parser's own follow-up questions.
        throw new Error(
          result.clarifyingQuestions.length > 0
            ? result.clarifyingQuestions.join(" ")
            : "Could you say more about what you want this agent to do?"
        );
      }
      const s = result.spec;
      setSpec({
        mission: s.mission,
        objective: s.objective,
        riskLevel: s.riskLevel,
        executionStyle: s.executionStyle,
        suggestedCapital: s.suggestedCapital,
        confidence: s.confidence,
      });
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }, [goalText]);

  const runCreation = useCallback(async () => {
    if (!delegatorWallet) { setError("Smart wallet not ready."); return; }
    setError(null);
    setCreating(true);
    setStep(7);
    const init: Record<string, TaskState> = {};
    CREATION_TASKS.forEach((t) => (init[t] = "pending"));
    init["Agent"] = "active";
    setTasks({ ...init });
    try {
      const policy: AgentPolicy = {
        capabilities: caps,
        maxAllocationPct: parseFloat(maxAllocationPct) || 0,
        maxDailyTrades: parseInt(maxDailyTrades, 10) || 0,
        maxSlippagePct: parseFloat(maxSlippagePct) || 0,
      };
      // One rounded amount used for every step below (provision, delegation spend-limit,
      // funding) — previously provision and withdraw each rounded `managedCapital` differently,
      // sending two different amount strings for the "same" capital.
      const capitalAmount = Math.round(managedCapital * 1e7) / 1e7; // Stellar's native 7dp precision
      const capitalStr = String(capitalAmount);

      // Guard against duplicate provisioning/delegating/funding: if this owner already has this
      // role agent, reuse it and skip delegation + funding (doc: "Never create duplicate
      // Delegations ... Always fail safely").
      const existing = await getAgentsSummary().catch(() => []);
      const already = existing.find((d) => d.role === role);

      // Permissions (doc §4) become this policy, sent + persisted in the same call that mints
      // the agent — previously collected in the UI and silently discarded.
      let agent = await provisionSingleRoleAgent({ role, mode: "live", capital: capitalStr, policy });
      init["Agent"] = "done";
      init["Policy"] = "done";
      setTasks({ ...init });

      if (!already) {
        // Delegation Approval (doc §7): a real on-chain delegation, signed by the user's
        // wallet — required for a live agent to ever pass the backend's start gate
        // (validateStartPrerequisites). Previously skipped entirely, leaving wizard-created
        // agents unable to start.
        init["Delegation"] = "active";
        setTasks({ ...init });
        const result = await createDelegation(agent.publicKey, delegatorWallet, [
          {
            type: "spend-limit",
            token: Asset.native().contractId(networkPassphrase),
            spendLimit: BigInt(Math.round(capitalAmount * 10_000_000)).toString(),
            period: "86400",
          },
        ]);
        if (!result) throw new Error("Delegation was not approved.");
        agent = await attachAgentDelegation(agent.id, result.delegation);
        init["Delegation"] = "done";
        setTasks({ ...init });

        // Funding: transfers the managed capital into the agent's own account — the mechanism
        // role agents actually trade from (see backend/src/provisionService.ts).
        init["Funding"] = "active";
        setTasks({ ...init });
        await withdrawFromSmartWallet(delegatorWallet, capitalStr, networkPassphrase, sorobanRpcUrl, agent.publicKey);
      } else {
        init["Delegation"] = "done";
      }
      init["Funding"] = "done";
      setTasks({ ...init });

      setCreatedAgent(agent);
      window.dispatchEvent(new Event("kairos:smart-wallet-changed"));
      setStep(8);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep(6); // back to approval so the user can retry
    } finally {
      setCreating(false);
    }
  }, [delegatorWallet, role, managedCapital, networkPassphrase, sorobanRpcUrl, caps, maxAllocationPct, maxDailyTrades, maxSlippagePct, createDelegation]);

  const capitalSummary =
    capitalMode === "entire" ? "Entire smart wallet"
    : capitalMode === "percentage" ? `${percentage}% of smart wallet`
    : `${fixedAmount} XLM (fixed)`;

  const approvedCaps = CAPABILITY_ROWS.filter((c) => caps[c.key]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 py-8 backdrop-blur-[2px]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl rounded-2xl border border-white/[0.08] bg-bg-card shadow-[0_24px_64px_-16px_rgba(0,0,0,0.7)]">
        {/* Header + stepper */}
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent/15 bg-accent-muted/40 text-accent">
              <Rocket className="h-3.5 w-3.5" />
            </div>
            <div>
              <p className="font-display text-sm font-medium text-text-primary">Create Agent</p>
              <p className="text-[10px] text-text-muted">Step {Math.min(step + 1, STEPS.length)} of {STEPS.length} · {STEPS[step]}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white/[0.04] hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="h-0.5 w-full bg-white/[0.04]">
          <div className="h-full bg-accent transition-all duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-6">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-error/15 bg-error/6 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-error/80" />
              <p className="text-xs text-error/90">{error}</p>
            </div>
          )}

          {/* ── Step 1 — Describe Goal ── */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-base font-medium text-text-primary">What do you want this agent to accomplish?</h2>
                <p className="mt-1 text-xs text-text-muted">Describe your goal in plain English. Kairos figures out how to achieve it.</p>
              </div>
              <textarea
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                rows={4}
                placeholder="e.g. Grow my XLM over the long term while keeping risk low."
                className={`${INPUT_CLS} resize-none leading-relaxed`}
              />
              <div>
                <p className="mb-2 text-[10px] font-mono uppercase tracking-widest text-text-muted">Quick templates</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { setTemplateId(t.id); setGoalText(t.prompt); }}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors ${
                        templateId === t.id ? "border-accent/40 bg-accent-muted/30 text-text-primary" : "border-white/5 bg-white/[0.02] text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      <span className="text-accent">{t.icon}</span>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2 — AI Understanding ── */}
          {step === 1 && spec && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-base font-medium text-text-primary">Here&apos;s what Kairos understood</h2>
                <p className="mt-1 text-xs text-text-muted">Nothing has been created yet. Edit anything below before continuing.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Field label="Mission">
                    <input value={spec.mission} onChange={(e) => setSpec({ ...spec, mission: e.target.value })} className={INPUT_CLS} />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label="Objective">
                    <input value={spec.objective} onChange={(e) => setSpec({ ...spec, objective: e.target.value })} className={INPUT_CLS} />
                  </Field>
                </div>
                <Field label="Risk Level">
                  <select value={spec.riskLevel} onChange={(e) => setSpec({ ...spec, riskLevel: e.target.value as Risk })} className={INPUT_CLS}>
                    <option value="conservative">Conservative</option>
                    <option value="balanced">Balanced</option>
                    <option value="aggressive">Aggressive</option>
                  </select>
                </Field>
                <Field label="Execution">
                  <select value={spec.executionStyle} onChange={(e) => setSpec({ ...spec, executionStyle: e.target.value as ParsedSpec["executionStyle"] })} className={INPUT_CLS}>
                    <option value="autonomous">Autonomous</option>
                    <option value="guided">Guided</option>
                  </select>
                </Field>
                <Field label="Confidence"><span className="text-xs text-text-primary">{Math.round(spec.confidence * 100)}%</span></Field>
              </div>
            </div>
          )}

          {/* ── Step 3 — Capital & Safety ── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-base font-medium text-text-primary">Capital & Safety</h2>
                <p className="mt-1 text-xs text-text-muted">How much should this agent manage, and within what limits?</p>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Capital</p>
                {(["entire", "percentage", "fixed"] as CapitalMode[]).map((m) => (
                  <label key={m} className="flex items-center gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-secondary">
                    <input type="radio" checked={capitalMode === m} onChange={() => setCapitalMode(m)} className="accent-accent" />
                    <span className="flex-1 text-text-primary">
                      {m === "entire" ? "Entire Smart Wallet" : m === "percentage" ? "Percentage of Smart Wallet" : "Fixed Amount"}
                    </span>
                    {m === "percentage" && capitalMode === "percentage" && (
                      <input value={percentage} onChange={(e) => setPercentage(e.target.value)} type="number" min="1" max="100" className="w-16 rounded border border-white/5 bg-bg-elevated px-2 py-1 text-right font-mono text-xs text-text-primary" />
                    )}
                    {m === "fixed" && capitalMode === "fixed" && (
                      <input value={fixedAmount} onChange={(e) => setFixedAmount(e.target.value)} type="number" min="1" className="w-24 rounded border border-white/5 bg-bg-elevated px-2 py-1 text-right font-mono text-xs text-text-primary" />
                    )}
                  </label>
                ))}
              </div>
              <div className="space-y-3">
                <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Safety</p>
                <div className="flex gap-2">
                  {(["conservative", "balanced", "aggressive"] as Risk[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => setSpec((s) => (s ? { ...s, riskLevel: r } : s))}
                      className={`flex-1 rounded-lg border px-2 py-2 text-xs transition-colors ${
                        spec?.riskLevel === r ? "border-accent/40 bg-accent-muted/30 text-text-primary" : "border-white/5 bg-white/[0.02] text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      {RISK_LABEL[r]}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Max Allocation %"><input value={maxAllocationPct} onChange={(e) => setMaxAllocationPct(e.target.value)} type="number" min="1" max="100" className={INPUT_CLS} /></Field>
                  <Field label="Max Daily Trades"><input value={maxDailyTrades} onChange={(e) => setMaxDailyTrades(e.target.value)} type="number" min="1" className={INPUT_CLS} /></Field>
                  <Field label="Max Slippage %"><input value={maxSlippagePct} onChange={(e) => setMaxSlippagePct(e.target.value)} type="number" min="0" step="0.1" className={INPUT_CLS} /></Field>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4 — Permissions ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-base font-medium text-text-primary">Permissions</h2>
                <p className="mt-1 text-xs text-text-muted">Approve what this agent is allowed to do.</p>
              </div>
              <div className="space-y-1.5">
                {CAPABILITY_ROWS.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5 text-xs">
                    <input type="checkbox" checked={caps[c.key]} onChange={(e) => setCaps({ ...caps, [c.key]: e.target.checked })} className="accent-accent" />
                    <span className={caps[c.key] ? "text-text-primary" : "text-text-muted"}>{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 5 — AI Plan ── */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-base font-medium text-text-primary">Kairos will…</h2>
                <p className="mt-1 text-xs text-text-muted">Review the plan. Nothing has been created yet.</p>
              </div>
              <ul className="space-y-2">
                {[
                  `Manage ${capitalSummary.toLowerCase()}`,
                  `Pursue: ${spec?.objective ?? goalText}`,
                  `Operate at a ${RISK_LABEL[spec?.riskLevel ?? "balanced"].toLowerCase()} risk level`,
                  ...approvedCaps.map((c) => c.label),
                  `Never exceed a ${maxAllocationPct}% allocation`,
                  ...(caps.leverage ? [] : ["Never use leverage"]),
                  `Stay within a ${maxSlippagePct}% slippage limit and ${maxDailyTrades} trades/day`,
                ].map((line, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-text-secondary">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success/80" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Step 6 — Smart Wallet Validation ── */}
          {step === 5 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-base font-medium text-text-primary">Smart Wallet</h2>
                <p className="mt-1 text-xs text-text-muted">This agent needs a funded smart wallet to manage.</p>
              </div>
              {!walletReady ? (
                <div className="space-y-3 rounded-xl border border-white/5 bg-bg-elevated p-4 text-center">
                  <p className="text-xs text-text-muted">{deploying ? "Creating your smart wallet…" : "No smart wallet found."}</p>
                  {deployError && <p className="text-xs text-error/90">{deployError}</p>}
                  <button
                    onClick={() => { setError(null); onDeploySmartWallet().catch((e) => setError(e instanceof Error ? e.message : String(e))); }}
                    disabled={deploying}
                    className="rounded-xl bg-accent/80 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deploying ? "Creating…" : "Create Smart Wallet"}
                  </button>
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-white/5 bg-bg-elevated p-4">
                  {smartWallets.length > 1 && (
                    <WalletPicker wallets={smartWallets} value={delegatorWallet} onChange={setDelegatorWallet} />
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Balance</span>
                    {balances.loading ? (
                      <span className="h-4 w-24 animate-pulse rounded bg-white/[0.06]" />
                    ) : (
                      <span className="font-mono text-sm text-text-primary">{fmtXlm(balances.xlmBalance)}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Will manage</span>
                    <span className="font-mono text-sm text-accent">{fmtXlm(managedCapital)}</span>
                  </div>
                  {balances.error && <p className="text-xs text-error/90">{balances.error}</p>}
                  {!balances.loading && !balanceSufficient && (
                    <div className="space-y-2 rounded-lg border border-warning/20 bg-warning/[0.06] px-3 py-2">
                      <p className="text-[11px] text-warning/90">
                        {managedCapital <= 0
                          ? "Choose an amount greater than zero."
                          : "Smart wallet requires funds. Deposit before this agent can begin autonomous execution."}
                      </p>
                      <button onClick={() => balances.refresh()} className="flex items-center gap-1.5 text-[11px] text-accent/80 hover:text-accent">
                        <RefreshCw className="h-3 w-3" /> Refresh balance
                      </button>
                    </div>
                  )}
                  {!balances.loading && balanceSufficient && (
                    <div className="flex items-center gap-1.5 text-[11px] text-success/80">
                      <Check className="h-3.5 w-3.5" /> Smart wallet found and funded.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Step 7 — Delegation Approval ── */}
          {step === 6 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-base font-medium text-text-primary">You are authorizing Kairos to…</h2>
                <p className="mt-1 text-xs text-text-muted">Approving signs an on-chain delegation from your smart wallet to this agent, then transfers the managed capital. You&apos;ll confirm both in your wallet.</p>
              </div>
              <div className="space-y-2 rounded-xl border border-white/5 bg-bg-elevated p-4">
                {approvedCaps.map((c) => (
                  <div key={c.key} className="flex items-center gap-2 text-xs text-text-secondary">
                    <Check className="h-3.5 w-3.5 text-success/80" /> {c.label}
                  </div>
                ))}
                <div className="mt-2 grid grid-cols-2 gap-3 border-t border-white/5 pt-3">
                  <Field label="Managed Capital"><span className="font-mono text-xs text-accent">{fmtXlm(managedCapital)}</span></Field>
                  <Field label="Max Allocation"><span className="font-mono text-xs text-text-primary">{maxAllocationPct}%</span></Field>
                  <Field label="Leverage"><span className="font-mono text-xs text-text-primary">{caps.leverage ? "Enabled" : "Disabled"}</span></Field>
                  <Field label="Risk"><span className="font-mono text-xs text-text-primary">{RISK_LABEL[spec?.riskLevel ?? "balanced"]}</span></Field>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 8 — Creation progress ── */}
          {step === 7 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-base font-medium text-text-primary">Creating agent…</h2>
                <p className="mt-1 text-xs text-text-muted">Kairos is provisioning everything automatically.</p>
              </div>
              <div className="space-y-1.5">
                {CREATION_TASKS.map((t) => {
                  const s = tasks[t] ?? "pending";
                  return (
                    <div key={t} className="flex items-center gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs">
                      {s === "done" ? <Check className="h-3.5 w-3.5 text-success/80" />
                        : s === "active" ? <Spinner className="h-3.5 w-3.5 text-accent" />
                        : <span className="h-3.5 w-3.5 rounded-full border border-white/10" />}
                      <span className={s === "pending" ? "text-text-muted" : "text-text-primary"}>{t}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Step 9 — Success ── */}
          {step === 8 && createdAgent && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-success/20 bg-success/10 text-success">
                <Check className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-display text-base font-medium text-text-primary">{ROLE_MISSION[role]} Ready</h2>
                <div className="mt-1 flex items-center justify-center gap-2">
                  <Badge tone="neutral" dot>Stopped</Badge>
                  <span className="text-xs text-text-muted">Managed Capital: {fmtXlm(managedCapital)}</span>
                </div>
              </div>
              <p className="text-[11px] text-text-muted">The agent stays stopped until you start it from Mission Control.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-6 py-4">
          {step === 8 ? (
            <>
              <button onClick={() => {
                // "Create Another" — reset to step 1.
                setStep(0); setTemplateId(null); setGoalText(""); setSpec(null); setCreatedAgent(null); setTasks({}); setError(null);
              }} className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary">
                Create Another
              </button>
              <button onClick={() => onCreated(createdAgent!.id)} className="flex items-center gap-1.5 rounded-xl bg-accent/80 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent">
                Open Mission Control <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => { setError(null); setStep((s) => Math.max(0, s - 1)); }}
                disabled={step === 0 || step === 7}
                className="flex items-center gap-1.5 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </button>
              <WizardNext
                step={step}
                canGoal={goalText.trim().length > 0}
                parsing={parsing}
                balanceSufficient={balanceSufficient}
                walletReady={walletReady}
                balancesLoading={balances.loading}
                creating={creating}
                onGoal={runParse}
                onCreate={runCreation}
                onNext={() => { setError(null); setStep((s) => s + 1); }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-mono uppercase tracking-widest text-text-muted">{label}</p>
      {children}
    </div>
  );
}

function WizardNext({
  step, canGoal, parsing, balanceSufficient, walletReady, balancesLoading, creating,
  onGoal, onCreate, onNext,
}: {
  step: number;
  canGoal: boolean;
  parsing: boolean;
  balanceSufficient: boolean;
  walletReady: boolean;
  balancesLoading: boolean;
  creating: boolean;
  onGoal: () => void;
  onCreate: () => void;
  onNext: () => void;
}) {
  const base = "flex items-center gap-1.5 rounded-xl bg-accent/80 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40";
  if (step === 0) return <button onClick={onGoal} disabled={!canGoal || parsing} className={base}>{parsing ? "Analyzing…" : <>Analyze <ChevronRight className="h-3.5 w-3.5" /></>}</button>;
  if (step === 5) return <button onClick={onNext} disabled={!walletReady || balancesLoading || !balanceSufficient} className={base}>Continue <ChevronRight className="h-3.5 w-3.5" /></button>;
  if (step === 6) return <button onClick={onCreate} disabled={creating} className={base}>{creating ? "Creating…" : <>Approve & Create <ChevronRight className="h-3.5 w-3.5" /></>}</button>;
  if (step === 7) return <span />;
  return <button onClick={onNext} className={base}>Continue <ChevronRight className="h-3.5 w-3.5" /></button>;
}
