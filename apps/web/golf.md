# Kairos Trade Page Rewrite — Summary

## Objective
Remove all paper trading infrastructure and shift the entire Kairos app to real Stellar testnet trading (XLM/USDC) via smart wallet delegations. Only XLM + testnet USDC (Circle issuer), no paper fallback, and autonomous execution through the delegation system.

---

## Phase 1 — Strip Paper Trading

**Deleted 5 files:**
- `lib/paper-trading/index.ts` — paper engine
- `hooks/usePaperTrading.ts` — paper trading hook
- `api/paper-trade/route.ts` — paper trade API
- `api/trades/route.ts` — trade history API
- `api/portfolio/route.ts` — portfolio API

**Rewrote 4 pages:**
- `dashboard/page.tsx` — simplified to wallet status + quick links
- `portfolio/page.tsx` — stub (was paper portfolio)
- `history/page.tsx` — stub (was paper history)
- `settings/page.tsx` — removed paper settings card

**Updated components:**
- `AdvancedChart.tsx` — removed paper trade references
- `TradingPanel.tsx` — removed paper buttons
- `PositionTracker.tsx` — removed paper positions
- `TradeHistory.tsx` — removed paper history

---

## Phase 2 — Real Stellar Balances Hook

**Created `hooks/useStellarBalances.ts`:**
- Polls Horizon via `fetchAccountBalances` every 10s
- Returns `xlmBalance`, `usdcBalance`, `hasUsdcTrustline`, `loading`, `error`, `refresh()`
- Cleans up interval on unmount

---

## Phase 3 — Auto-Deploy Smart Wallet Hook

**Created `hooks/useSmartWallet.ts`:**
- Connects Freighter, persists wallet + smart wallet address in localStorage
- Auto-deploys smart wallet if none saved (PREPARE → sign → SUBMIT via `/api/delegate-sdk`)
- Auto-reconnects on mount via `tryCheckConnection`
- Returns wallet state, smart wallet address/balance, deploy status/errors
- Exposes `connect()`, `disconnect()`, `deploySmartWallet()`

---

## Phase 4 — Trade Page Rewrite (Always Real DEX)

**Rewrote `dashboard/trade/page.tsx`:**

Removed:
- `usePaperTrading` import and all paper trading state/logic
- `useSearchParams` — symbol is always `XLMUSDT`
- `DelegationKit` component — replaced with inline wallet card
- `isRealPair` branching — always real
- Multi-symbol support (`topSymbols`, `baseAsset()`, symbol selector)
- Paper price display (timeStr, priceFlash, prevPriceRef)
- Paper maxAmount/estCost/handleManualTrade
- Paper position snapshot card (heldPosition)
- `useSyncExternalStore` connect-event subscription

Added:
- `useSmartWallet` — single source of truth for wallet connection
- `useStellarBalances` — auto-polling for XLM/USDC balances
- Inline wallet connect/disconnect card with smart wallet status
- All manual mode UI now shows real DEX price, real balances, trustline management, real swap execution

---

## Phase 5 — Autonomous Execution via Delegation

**Wired Strategy/Intent/Agent modes to create real delegations:**

Added `createTradeDelegation()` helper:
1. `PREPARE_DELEGATION` → server builds unsigned delegation + hash
2. User signs hash via Freighter SEP-53 (`signDelegationHashWithFreighter`)
3. `SUBMIT_DELEGATION` → server attaches signature, returns final hash + delegation
4. Progress states: `"preparing"` → `"signing"` → `"submitting"`

Changes per mode:
- **Strategy**: Removed "Preview" badge. "Deploy Strategy" creates a self-delegation (delegate = wallet owner) with 30-day time-restriction policy.
- **Intent**: Removed "Preview" badge. "Parse Intent" calls `/api/intent/parse` (HF Mixtral → regex fallback). Shows parsed TradingProfile. "Confirm & Deploy" creates a delegation.
- **Agent**: Removed "Preview" badge. Added "Agent Public Key" input. "Start Agent" creates a delegation targeting the agent's G-address with risk-adjusted duration (7/30/90 days).

All modes show delegation progress and disable inputs during creation.

---

## Phase 6 — Polish Mode UIs

**Post-deployment result states for all three modes:**

- **Strategy**: After deploy, shows success card with strategy config summary (template, amount, TP/SL%), copy hash button, "View Delegations →" link, "Deploy Another" button.
- **Intent**: Human-readable TradingProfile labels (Risk Tolerance, Horizon, Assets, etc.). Array values joined with commas. After confirm, shows profile + delegation hash with copy/link/create-another.
- **Agent**: After start, shows delegate address (truncated), risk level, delegation hash with copy button. Setup instructions for `~/.kairos/delegations/` with downloadable JSON export.

---

## Phase 7 — Cleanup

**Deleted dead components:**
- `components/charts/EquityCurve.tsx` — unused
- `components/charts/AllocationPie.tsx` — unused

---

## Final File State

- `hooks/useSmartWallet.ts` — wallet connect + auto-deploy
- `hooks/useStellarBalances.ts` — XLM/USDC balance polling
- `dashboard/trade/page.tsx` — always-real Stellar DEX trading with full delegation support
- `dashboard/delegations-v2/` — delegation management UI (unchanged, fully functional)
- `components/charts/` — remaining: AdvancedChart, ChartToolbar, MiniChart, OrderBook, PositionTracker, PriceAlertsPanel, PriceChart, ScreenshotButton, TradingPanel, drawing-tools/

**Lint: 0 errors, 0 warnings**
