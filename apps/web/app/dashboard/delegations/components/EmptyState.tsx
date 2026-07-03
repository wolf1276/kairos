"use client";

export function EmptyState({
  hasWallet,
  hasError,
  onConnect,
  onCreate,
}: {
  hasWallet: boolean;
  hasError: string | null;
  onConnect: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-accent-muted/30">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="opacity-60"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      <h2 className="font-display text-lg font-medium text-text-primary">
        {hasError
          ? "Connection Error"
          : !hasWallet
            ? "Connect Your Wallet"
            : "No Delegations Yet"}
      </h2>

      <p className="mt-2 max-w-sm text-sm text-text-muted leading-relaxed">
        {hasError
          ? hasError
          : !hasWallet
            ? "Connect your Freighter wallet to deploy a smart wallet and create delegations. Your assets remain in your control at all times."
            : "Create your first delegation to grant permission for automated trading. You remain in full control — every action is recorded and revocable."}
      </p>

      <div className="mt-8 flex items-center gap-3">
        {!hasWallet ? (
          <button
            onClick={onConnect}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:bg-accent-hover"
          >
            Connect Wallet
          </button>
        ) : (
          <button
            onClick={onCreate}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:bg-accent-hover"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create Your First Delegation
          </button>
        )}
      </div>

      {!hasWallet && !hasError && (
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3 max-w-2xl">
          {[
            {
              title: "You Stay in Control",
              desc: "Assets remain in your wallet. Delegations are revocable at any time.",
            },
            {
              title: "Limited Permissions",
              desc: "Set policies to restrict what the delegate can do and how much they can spend.",
            },
            {
              title: "Full Transparency",
              desc: "Every execution is recorded on-chain. Nothing happens without your knowledge.",
            },
          ].map((benefit) => (
            <div
              key={benefit.title}
              className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-left"
            >
              <p className="text-xs font-medium text-text-primary">{benefit.title}</p>
              <p className="mt-1 text-[11px] text-text-muted leading-relaxed">{benefit.desc}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
