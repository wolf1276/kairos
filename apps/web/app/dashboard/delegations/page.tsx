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
import { ConfirmRevokeDialog } from "./components/ConfirmRevokeDialog";
import { DelegationDetailDrawer } from "./components/DelegationDetailDrawer";
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
  const delegationsApi = useDelegations(
    wallet.walletOwner,
    wallet.smartWalletAddress,
    wallet.wallet?.networkPassphrase ?? "Test SDF Network ; September 2015"
  );
  const timeline = useActivityTimeline();
  const [filters, setFilters] = useState<DelegationFilters>(DEFAULT_FILTERS);
  const [selectedDelegation, setSelectedDelegation] = useState<DelegationRecord | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<ToastData | null>(null);

  // Confirmation dialog state
  const [confirmRevoke, setConfirmRevoke] = useState<DelegationRecord[] | null>(null);

  const filtered = delegationsApi.filteredDelegations(filters);
  const shouldShowDelegations = wallet.walletOwner && !delegationsApi.error;
  const isInitialLoading = delegationsApi.loading && delegationsApi.delegations.length === 0;

  const dismissToast = useCallback(() => setToast(null), []);

  const showToast = useCallback((kind: ToastData["kind"], title: string, message?: string, action?: { label: string; onClick: () => void }) => {
    setToast({ kind, title, message, action });
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

  // ── Revoke with confirmation and undo ──

  const executeRevoke = useCallback(
    async (d: DelegationRecord) => {
      await delegationsApi.revoke(d);
      timeline.addEvent(d.hash, "revoked");
      showToast("info", "Delegation Revoked", `${d.hash.slice(0, 8)}…${d.hash.slice(-6)} has been disabled`, {
        label: "Undo",
        onClick: async () => {
          await delegationsApi.enable(d);
          timeline.addEvent(d.hash, "enabled");
          showToast("success", "Delegation Restored", `${d.hash.slice(0, 8)}…${d.hash.slice(-6)} is active again`);
        },
      });
    },
    [delegationsApi, showToast, timeline]
  );

  const handleRevokeClick = useCallback(
    async (d: DelegationRecord) => {
      setConfirmRevoke([d]);
    },
    []
  );

  const handleConfirmRevoke = useCallback(async () => {
    const list = confirmRevoke;
    setConfirmRevoke(null);
    if (!list || list.length === 0) return;

    if (list.length === 1) {
      await executeRevoke(list[0]);
    } else {
      // Batch revoke
      const hashes: string[] = [];
      for (const d of list) {
        if (!d.disabled) {
          await delegationsApi.revoke(d);
          timeline.addEvent(d.hash, "revoked");
          hashes.push(d.hash);
        }
      }
      showToast("info", "Batch Revoke", `${hashes.length} delegation${hashes.length !== 1 ? "s" : ""} revoked`, hashes.length > 0 ? {
        label: "Undo All",
        onClick: async () => {
          for (const d of list) {
            if (hashes.includes(d.hash)) {
              await delegationsApi.enable(d);
              timeline.addEvent(d.hash, "enabled");
            }
          }
          showToast("success", "Batch Restored", `${hashes.length} delegation${hashes.length !== 1 ? "s" : ""} re-enabled`);
        },
      } : undefined);
      setSelectedHashes(new Set());
      setSelectMode(false);
    }
  }, [confirmRevoke, executeRevoke, delegationsApi, showToast, timeline]);

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

  const handleBatchRevokeClick = useCallback(() => {
    const dels = [...selectedHashes]
      .map((hash) => delegationsApi.delegations.find((d) => d.hash === hash))
      .filter((d): d is DelegationRecord => !!d && !d.disabled);
    if (dels.length === 0) return;
    setConfirmRevoke(dels);
  }, [selectedHashes, delegationsApi.delegations]);

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
      {/* Page Header */}
      <DelegationHeader stats={delegationsApi.stats} onCreateClick={handleCreate} />

      {/* Statistics Cards */}
      {isInitialLoading ? <StatsSkeleton /> : shouldShowDelegations && (
        <StatsCards stats={delegationsApi.stats} loading={delegationsApi.loading} />
      )}

      {/* Search & Filter */}
      {shouldShowDelegations && (
        <SearchFilter
          filters={filters}
          onChange={setFilters}
          total={filtered.length}
        />
      )}

      {/* Error State */}
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

      {/* Select mode toggle + Batch bar */}
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
                onClick={handleBatchRevokeClick}
                className="rounded-lg bg-error/10 px-3 py-1.5 text-[11px] font-medium text-error hover:bg-error/15 transition-colors cursor-pointer"
              >
                Revoke {selectedHashes.size > 1 ? `(${selectedHashes.size})` : ""}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Delegation List / Empty / Loading */}
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
          onRevoke={handleRevokeClick}
          onEnable={handleEnable}
          onView={handleView}
          actionLoading={delegationsApi.actionLoading}
          actionErrors={delegationsApi.actionErrors}
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

      {/* Template picker modal (shown before wizard) */}
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

      {/* Create Delegation Wizard */}
      <CreateDelegationWizard
        open={showWizard}
        walletOwner={wallet.walletOwner}
        networkPassphrase={wallet.wallet?.networkPassphrase ?? "Test SDF Network ; September 2015"}
        onCreate={handleWizardCreate}
        onClose={handleWizardClose}
      />

      {/* Detail Drawer */}
      {selectedDelegation && (
        <DelegationDetailDrawer
          delegation={selectedDelegation}
          onClose={handleCloseDetail}
          onRevoke={handleRevokeClick}
          onEnable={handleEnable}
          onDuplicate={handleDuplicate}
          onUpdatePolicy={delegationsApi.updatePolicy}
          actionLoading={delegationsApi.actionLoading}
          actionErrors={delegationsApi.actionErrors}
        />
      )}

      {/* Confirmation Dialog */}
      <ConfirmRevokeDialog
        open={confirmRevoke !== null}
        delegations={confirmRevoke ?? []}
        onClose={() => setConfirmRevoke(null)}
        onConfirm={handleConfirmRevoke}
      />

      <ToastBar toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
