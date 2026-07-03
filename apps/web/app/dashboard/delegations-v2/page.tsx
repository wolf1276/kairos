"use client";

import { useState, useCallback, useEffect } from "react";
import { useDelegations } from "./hooks/useDelegations";
import { useWallet } from "./hooks/useWallet";
import { DelegationHeader } from "./components/DelegationHeader";
import { StatsCards } from "./components/StatsCards";
import { SearchFilter } from "./components/SearchFilter";
import { DelegationList } from "./components/DelegationList";
import { EmptyState } from "./components/EmptyState";
import { StatsSkeleton, DelegationListSkeleton } from "./components/LoadingSkeleton";
import { CreateDelegationWizard } from "./components/CreateDelegationWizard";
import { ActivityTimeline } from "./components/ActivityTimeline";
import { TemplateSelector } from "./components/TemplateSelector";
import { ToastBar, type ToastData } from "./components/Toast";
import { useActivityTimeline } from "./hooks/useActivityTimeline";
import type { DelegationRecord, DelegationFilters, DelegationTemplate } from "./types/delegation";

const DEFAULT_FILTERS: DelegationFilters = {
  search: "",
  status: "all",
  asset: "",
  sort: "newest",
};

export default function DelegationsV2Page() {
  const wallet = useWallet();
  const delegationsApi = useDelegations(wallet.walletOwner);
  const timeline = useActivityTimeline();
  const [filters, setFilters] = useState<DelegationFilters>(DEFAULT_FILTERS);
  const [selectedDelegation, setSelectedDelegation] = useState<DelegationRecord | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<ToastData | null>(null);

  const filtered = delegationsApi.filteredDelegations(filters);
  const shouldShowDelegations = wallet.walletOwner && !delegationsApi.error;
  const isInitialLoading = delegationsApi.loading && delegationsApi.delegations.length === 0;

  const dismissToast = useCallback(() => setToast(null), []);

  const showToast = useCallback((kind: ToastData["kind"], title: string, message?: string) => {
    setToast({ kind, title, message });
  }, []);

  // Close drawer on Escape
  useEffect(() => {
    if (!selectedDelegation) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedDelegation(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedDelegation]);

  const handleView = useCallback((d: DelegationRecord) => {
    setSelectedDelegation(d);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedDelegation(null);
  }, []);

  const handleCreate = useCallback(() => {
    setShowTemplatePicker(true);
    setShowWizard(true);
  }, []);

  const handleTemplateSelect = useCallback((template: DelegationTemplate) => {
    setShowTemplatePicker(false);
    void template;
  }, []);

  const handleSkipTemplates = useCallback(() => {
    setShowTemplatePicker(false);
  }, []);

  const handleDuplicate = useCallback((d: DelegationRecord) => {
    setShowWizard(true);
    setShowTemplatePicker(false);
    void d;
  }, []);

  const handleWizardClose = useCallback(() => {
    setShowWizard(false);
  }, []);

  const handleWizardCreate = useCallback(
    async (delegate: string, policies: Record<string, unknown>[]): Promise<string> => {
      const hash = await delegationsApi.createDelegation(delegate, policies);
      timeline.addEvent(hash, "created", `${policies.length} policies`, hash);
      showToast("success", "Delegation Created", `Hash: ${hash.slice(0, 8)}…${hash.slice(-6)}`);
      return hash;
    },
    [delegationsApi, showToast, timeline]
  );

  const handleRevoke = useCallback(
    async (d: DelegationRecord) => {
      await delegationsApi.revoke(d);
      timeline.addEvent(d.hash, "revoked");
      showToast("info", "Delegation Revoked", `${d.hash.slice(0, 8)}…${d.hash.slice(-6)} has been disabled`);
    },
    [delegationsApi, showToast, timeline]
  );

  const toggleSelectMode = useCallback(() => {
    setSelectMode((prev) => {
      if (prev) setSelectedHashes(new Set());
      return !prev;
    });
  }, []);

  const toggleSelectHash = useCallback((hash: string) => {
    setSelectedHashes((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }, []);

  const handleBatchRevoke = useCallback(async () => {
    const hashes = [...selectedHashes];
    for (const hash of hashes) {
      const d = delegationsApi.delegations.find((d) => d.hash === hash);
      if (d && !d.disabled) {
        await delegationsApi.revoke(d);
        timeline.addEvent(d.hash, "revoked");
      }
    }
    showToast("info", "Batch Revoke", `${hashes.length} delegation${hashes.length !== 1 ? "s" : ""} revoked`);
    setSelectedHashes(new Set());
    setSelectMode(false);
  }, [selectedHashes, delegationsApi, showToast, timeline]);

  const handleEnable = useCallback(
    async (d: DelegationRecord) => {
      await delegationsApi.enable(d);
      timeline.addEvent(d.hash, "enabled");
      showToast("success", "Delegation Enabled", `${d.hash.slice(0, 8)}…${d.hash.slice(-6)} is active again`);
    },
    [delegationsApi, showToast, timeline]
  );

  return (
    <div className="space-y-6">
      {/* Phase 2: Page Header */}
      <DelegationHeader stats={delegationsApi.stats} onCreateClick={handleCreate} />

      {/* Phase 2: Statistics Cards */}
      {isInitialLoading ? <StatsSkeleton /> : shouldShowDelegations && (
        <StatsCards stats={delegationsApi.stats} loading={delegationsApi.loading} />
      )}

      {/* Phase 3: Search & Filter */}
      {shouldShowDelegations && (
        <SearchFilter
          filters={filters}
          onChange={setFilters}
          total={filtered.length}
        />
      )}

      {/* Phase 6: Error State */}
      {delegationsApi.error && (
        <div className="rounded-xl border border-error/15 bg-error/6 px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-error">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="text-xs text-error/90">{delegationsApi.error}</span>
            </div>
            <button
              onClick={delegationsApi.refresh}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-muted/50 transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Phase 9: Select mode toggle + Batch bar */}
      {shouldShowDelegations && delegationsApi.delegations.length > 0 && (
        <div className="flex items-center justify-between">
          <button
            onClick={toggleSelectMode}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all duration-200 cursor-pointer ${
              selectMode
                ? "bg-accent-muted/40 text-accent border border-accent/20"
                : "text-text-muted hover:text-text-secondary hover:bg-white/[0.04] border border-transparent"
            }`}
          >
            {selectMode ? "Cancel Selection" : "Select"}
          </button>
          {selectMode && selectedHashes.size > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-text-muted">{selectedHashes.size} selected</span>
              <button
                onClick={handleBatchRevoke}
                className="rounded-lg bg-error/10 px-3 py-1.5 text-[11px] font-medium text-error hover:bg-error/15 transition-colors cursor-pointer"
              >
                Revoke {selectedHashes.size > 1 ? `(${selectedHashes.size})` : ""}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Phase 4 & 7: Delegation List / Empty / Loading */}
      {isInitialLoading ? (
        <DelegationListSkeleton />
      ) : !wallet.walletOwner || delegationsApi.delegations.length === 0 ? (
        <EmptyState
          hasWallet={!!wallet.walletOwner}
          hasError={delegationsApi.error}
          onConnect={wallet.connect}
          onCreate={handleCreate}
        />
      ) : filtered.length > 0 ? (
        <DelegationList
          delegations={filtered}
          onRevoke={handleRevoke}
          onEnable={handleEnable}
          onView={handleView}
          actionLoading={delegationsApi.actionLoading}
          selectMode={selectMode}
          selectedHashes={selectedHashes}
          onToggleSelect={toggleSelectHash}
          onDuplicate={handleDuplicate}
        />
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-text-muted">No delegations match your filters.</p>
          <button
            onClick={() => setFilters(DEFAULT_FILTERS)}
            className="mt-2 text-xs text-accent hover:text-accent-hover transition-colors cursor-pointer"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Activity Timeline */}
      {wallet.walletOwner && timeline.events.length > 0 && (
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
          <ActivityTimeline events={timeline.events} onClear={timeline.clearEvents} />
        </div>
      )}

      {/* Phase 9: Template picker modal (shown before wizard) */}
      {showWizard && showTemplatePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { setShowWizard(false); setShowTemplatePicker(false); }} />
          <div className="relative w-full max-w-2xl bg-bg-primary border border-white/5 rounded-2xl shadow-2xl animate-fade-in-up p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-sm font-medium text-text-primary">Create Delegation</h2>
              <button
                onClick={() => { setShowWizard(false); setShowTemplatePicker(false); }}
                className="rounded-lg p-1.5 text-text-muted hover:text-text-secondary hover:bg-white/[0.04] transition-colors cursor-pointer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <TemplateSelector
              onSelect={handleTemplateSelect}
              onSkip={handleSkipTemplates}
            />
          </div>
        </div>
      )}

      {/* Phase 5: Create Delegation Wizard */}
      <CreateDelegationWizard
        open={showWizard}
        smartWalletAddress={wallet.smartWalletAddress}
        networkPassphrase={wallet.wallet?.networkPassphrase ?? "Test SDF Network ; September 2015"}
        onCreate={handleWizardCreate}
        onClose={handleWizardClose}
      />

      {/* Phase 5: Detail Drawer */}
      {selectedDelegation && (
        <SlideOverDrawer
          delegation={selectedDelegation}
          onClose={handleCloseDetail}
          onRevoke={handleRevoke}
          onEnable={handleEnable}
          actionLoading={delegationsApi.actionLoading}
        />
      )}

      <ToastBar toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

function SlideOverDrawer({
  delegation,
  onClose,
  onRevoke,
  onEnable,
  actionLoading,
}: {
  delegation: DelegationRecord;
  onClose: () => void;
  onRevoke: (d: DelegationRecord) => void;
  onEnable: (d: DelegationRecord) => void;
  actionLoading: string | null;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-bg-primary border-l border-white/5 shadow-2xl overflow-y-auto animate-slide-in-right">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/5 bg-bg-primary/90 backdrop-blur-sm px-6 py-4">
          <h2 className="font-display text-sm font-medium text-text-primary">
            Delegation Details
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted hover:text-text-secondary hover:bg-white/[0.04] transition-colors cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Overview */}
          <section>
            <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted mb-3">
              Overview
            </h3>
            <div className="space-y-3">
              <DetailRow label="Hash" value={delegation.hash} mono />
              <DetailRow label="Delegator" value={delegation.delegator} mono />
              {delegation.full && (
                <>
                  <DetailRow label="Delegate" value={delegation.full.delegate} mono />
                  <DetailRow label="Authority" value={delegation.full.authority} mono />
                  <DetailRow label="Nonce" value={delegation.full.nonce} mono />
                </>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-text-muted">Status</span>
                <span className={`text-[11px] font-mono font-medium ${delegation.disabled ? "text-error" : "text-success"}`}>
                  {delegation.disabled ? "Disabled" : "Active"}
                </span>
              </div>
            </div>
          </section>

          {/* Policies */}
          <section>
            <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted mb-3">
              Policies ({delegation.full?.caveats.length ?? 0})
            </h3>
            {delegation.full && delegation.full.caveats.length > 0 ? (
              <div className="space-y-2">
                {delegation.full.caveats.map((c, i) => (
                  <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <p className="text-xs font-mono text-text-primary">
                      Enforcer: {c.enforcer.slice(0, 8)}…{c.enforcer.slice(-4)}
                    </p>
                    <p className="mt-1 text-[11px] text-text-muted">
                      Terms: {c.terms.length} bytes
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted">No policies attached (unrestricted)</p>
            )}
          </section>

          {/* Actions */}
          <section className="pt-2 border-t border-white/5">
            <div className="flex gap-3">
              {delegation.full && (
                <button
                  onClick={() => (delegation.disabled ? onEnable(delegation) : onRevoke(delegation))}
                  disabled={actionLoading === delegation.hash}
                  className={`flex-1 rounded-xl px-4 py-2.5 text-xs font-semibold text-white transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                    delegation.disabled
                      ? "bg-emerald-600/80 hover:bg-emerald-600"
                      : "bg-red-600/80 hover:bg-red-600"
                  }`}
                >
                  {actionLoading === delegation.hash
                    ? "Processing..."
                    : delegation.disabled
                      ? "Enable Delegation"
                      : "Revoke Delegation"}
                </button>
              )}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(delegation.hash);
                }}
                className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
              >
                Copy Hash
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-text-muted">{label}</span>
      <span className={`text-[11px] ${mono ? "font-mono" : ""} text-text-secondary truncate ml-4 max-w-[240px] text-right`} title={value}>
        {value}
      </span>
    </div>
  );
}
