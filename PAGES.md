# Kairos Pages — Layout & Structure Reference

## ASCII Wireframes

```
─────────────────────────────────────────────────────
                      LANDING (/)
─────────────────────────────────────────────────────
┌───────────────────────────────────────────────────┐
│  Kairos    [Docs] [GitHub] [Twitter]              │
├───────────────────────────────────────────────────┤
│                                                   │
│         ╔══════════════════════════╗              │
│         ║  3D ShaderGradient BG   ║              │
│         ║                         ║              │
│         ║  Programmable Capital   ║              │
│         ║  Subtitle text          ║              │
│         ║  [Launch App] [Docs]    ║              │
│         ╚══════════════════════════╝              │
│                                                   │
└───────────────────────────────────────────────────┘
```

```
─────────────────────────────────────────────────────
              DASHBOARD OVERVIEW (/dashboard)
─────────────────────────────────────────────────────
┌───────────────────────────────────────────────────┐
│  Kairos  [Ov] [Tr] [Po] [De] [Hi] [Se]          │
├───────────────────────────────────────────────────┤
│  ═══ BTC $XX ═══ ETH $XX ═══ XLM $XX ═══ ...    │
├───────────────────────────────────────────────────┤
│                                                   
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐ │
│  │ Portfolio│ │  Cash    │ │Unrealized│ │ Open │ │
│  │  Value   │ │ Balance  │ │   PnL    │ │Pos.  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────┘ │
│                                                   
│  ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │New Trade │ │Portfolio │ │Delegation│         │
│  └──────────┘ └──────────┘ └──────────┘         │
│                                                   
│  ┌──────────────────┐  ┌──────────────────┐      │
│  │     MARKETS      │  │  RECENT TRADES   │      │
│  │  BTC  $XX  +2.3% │  │  Buy ETH 1.0     │      │
│  │  ETH  $XX  -1.1% │  │  Sell BTC 0.5    │      │
│  │  XLM  $XX  +0.5% │  │  ...             │      │
│  │  ...             │  │  [View All →]    │      │
│  └──────────────────┘  └──────────────────┘      │
└───────────────────────────────────────────────────┘
```

```
─────────────────────────────────────────────────────
                  TRADE (/dashboard/trade)
─────────────────────────────────────────────────────
┌───────────────────────────────────────────────────┐
│  Kairos  [Ov] [Tr] [Po] [De] [Hi] [Se]          │
├───────────────────────────────────────────────────┤
│  ═══ BTC $XX ═══ ETH $XX ═══ XLM $XX ═══ ...    │
├───────────────────────────────────────────────────┤
│                                                   
│  [  BTC  ] [  ETH  ] [  XLM  ] [  SOL  ] [  ADA ]
│  $XX +2.3%  $XX -1.1%  $XX +0.5%
│                                                   
│  ┌─────────────────────────┐  ┌───────────────┐   │
│  │                         │  │ QUICK TRADE   │   │
│  │    CANDLESTICK CHART    │  │ [Buy] [Sell]  │   │
│  │     (lightweight-charts)│  │ Price: $XX    │   │
│  │                         │  │ Amt: [____]   │   │
│  │  [15m][1H][4H][1D]     │  │ [25%][50%]    │   │
│  │                         │  │ [75%][100%]   │   │
│  ├─────────────────────────┤  │ Cost: $X.XX   │   │
│  │ PRICE VIEW PANEL        │  ├───────────────┤   │
│  │ VWAP Volatility Spread  │  │ DELEGATION KIT│   │
│  │ Trend Momentum Risk...  │  │ [Connect      │   │
│  │ AI Summary...           │  │  Freighter]   │   │
│  ├─────────────────────────┤  │ Send XLM:     │   │
│  │ AI ANALYSIS             │  │ [_______]     │   │
│  │ [Auto/Strategy/Auto]    │  │ [25][50]...   │   │
│  │ Intent: [_____________] │  └───────────────┘   │
│  │ [Analyze →]             │                      │
│  │ ┌───────────────────┐   │                      │
│  │ │ PROPOSAL: Buy ETH │   │                      │
│  │ │ Confidence: 84%   │   │                      │
│  │ │ Amt: 2.5 @ $X     │   │                      │
│  │ │ SL: $X  TP: $X    │   │                      │
│  │ │ [Execute]         │   │                      │
│  │ └───────────────────┘   │                      │
│  └─────────────────────────┘                      │
└───────────────────────────────────────────────────┘
```

```
─────────────────────────────────────────────────────
                PORTFOLIO (/dashboard/portfolio)
─────────────────────────────────────────────────────
┌───────────────────────────────────────────────────┐
│  Kairos  [Ov] [Tr] [Po] [De] [Hi] [Se]          │
├───────────────────────────────────────────────────┤
│  ═══ BTC $XX ═══ ETH $XX ═══ XLM $XX ═══ ...    │
├───────────────────────────────────────────────────┤
│                                                   
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐ │
│  │  Total   │ │  Cash    │ │Unrealized│ │Realiz│ │
│  │  Value   │ │ Balance  │ │   PnL    │ │ PnL  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────┘ │
│                                                   
│  ┌──────────────────┐  ┌──────────────────┐      │
│  │   EQUITY CURVE   │  │  ALLOCATION PIE  │      │
│  │  ╱╲    ╱╲        │  │     ╭────╮       │      │
│  │ ╱  ╲  ╱  ╲       │  │    ╱Cash ╲      │      │
│  │╱    ╲╱    ╲      │  │   │ 60%  │      │      │
│  │      (area chart) │  │    ╲BTC  ╱      │      │
│  └──────────────────┘  │     ╰────╯       │      │
│                         └──────────────────┘      │
│  ┌───────────────────────────────────────────┐    │
│  │          OPEN POSITIONS                    │    │
│  │  Asset  Amt  Entry  Mark  Value  PnL   ╳  │    │
│  │  BTC   0.5  $40K  $42K  $21K +5%  [Close]│    │
│  │  ETH   5.0  $3K   $3.1K $15.5K +3% [Close]│    │
│  └───────────────────────────────────────────┘    │
│  ┌───────────────────────────────────────────┐    │
│  │          RECENT ACTIVITY                   │    │
│  │  Buy ETH  1.0 @ $3,050  +$50  2m ago     │    │
│  │  Sell BTC 0.2 @ $41,200 +$200 15m ago    │    │
│  │  [View All History →]                     │    │
│  └───────────────────────────────────────────┘    │
└───────────────────────────────────────────────────┘
```

```
─────────────────────────────────────────────────────
                HISTORY (/dashboard/history)
─────────────────────────────────────────────────────
┌───────────────────────────────────────────────────┐
│  Kairos  [Ov] [Tr] [Po] [De] [Hi] [Se]          │
├───────────────────────────────────────────────────┤
│  ═══ BTC $XX ═══ ETH $XX ═══ XLM $XX ═══ ...    │
├───────────────────────────────────────────────────┤
│                                                   
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐ │
│  │  Total   │ │ Win Rate │ │Realized  │ │ Fees │ │
│  │  Trades  │ │   64%    │ │   PnL    │ │ $X   │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────┘ │
│                                                   
│  ┌───────────────────────────────────────────┐    │
│  │  Symbol: [_____]  Action: [All ▾]         │    │
│  │  47 results                    [Export CSV]│    │
│  ├───────────────────────────────────────────┤    │
│  │  Time ▴  Symbol  Action  Amt    Price  PnL│    │
│  │  12:30   ETH     [Buy]  1.0   $3,050 +$50│    │
│  │  12:15   BTC     [Sell] 0.2   $41.2K+$200│    │
│  │  11:50   XLM     [Buy]  100   $0.34  -$2 │    │
│  │  ...                                      │    │
│  ├───────────────────────────────────────────┤    │
│  │                    [← Prev]  [Next →]     │    │
│  └───────────────────────────────────────────┘    │
└───────────────────────────────────────────────────┘
```

```
─────────────────────────────────────────────────────
             DELEGATIONS (/dashboard/delegations)
─────────────────────────────────────────────────────
┌───────────────────────────────────────────────────┐
│  Kairos  [Ov] [Tr] [Po] [De] [Hi] [Se]          │
├───────────────────────────────────────────────────┤
│  ═══ BTC $XX ═══ ETH $XX ═══ XLM $XX ═══ ...    │
├───────────────────────────────────────────────────┤
│                                                   
│  ┌─────────────────────┐  ┌───────────────────┐   │
│  │   DELEGATION KIT    │  │ ACTIVE DELEGATIONS│   │
│  │                     │  │                   │   │
│  │  Freighter:         │  │  (placeholder)    │   │
│  │  [Not Connected]    │  │                   │   │
│  │  [Connect Wallet]   │  │                   │   │
│  │                     │  │                   │   │
│  │  Send XLM:          │  │                   │   │
│  │  Dest: [__________] │  │                   │   │
│  │  Amt: [_____]       │  │                   │   │
│  │  [25%][50%]         │  │                   │   │
│  │  [75%][100%]        │  │                   │   │
│  │                     │  │                   │   │
│  │  ─── ON-CHAIN ───  │  │                   │   │
│  │  [Deploy Smart      │  │                   │   │
│  │   Wallet]           │  │                   │   │
│  │  [Create Delegation]│  │                   │   │
│  │                     │  │                   │   │
│  │  Smart Wallet:      │  │                   │   │
│  │  0x...abc           │  │                   │   │
│  └─────────────────────┘  └───────────────────┘   │
└───────────────────────────────────────────────────┘
```

```
─────────────────────────────────────────────────────
                  SETTINGS (/settings)
─────────────────────────────────────────────────────
┌───────────────────────────────────────────────────┐
│  ← Dashboard    SETTINGS                          │
├───────────────────────────────────────────────────┤
│                                                   
│  ┌───────────────────────────────────────────┐    │
│  │         AUTOMATION DEFAULTS               │    │
│  │  Default Mode: [AI Managed ▾]             │    │
│  │  Default Symbol: [BTC ▾]                  │    │
│  └───────────────────────────────────────────┘    │
│                                                   
│  ┌───────────────────────────────────────────┐    │
│  │         STRATEGY PARAMETERS               │    │
│  │  EMA Fast: [12]  EMA Slow: [26]           │    │
│  │  RSI Oversold: [30]  RSI Overbought: [70] │    │
│  └───────────────────────────────────────────┘    │
│                                                   
│  ┌───────────────────────────────────────────┐    │
│  │         PAPER TRADING                     │    │
│  │  Fee: 0.10%  Slippage: 0.05%             │    │
│  │  Initial Balance: [$10,000]               │    │
│  │  [Reset Paper Wallet] ⚠️                  │    │
│  └───────────────────────────────────────────┘    │
│                                                   
│  [Save Settings]                                   │
└───────────────────────────────────────────────────┘
```

---

## Structured Layout Descriptions (AI-friendly)

### Page: Landing `/`

```yaml
route: "/"
file: apps/web/app/page.tsx
layout: fullscreen
purpose: Marketing landing page explaining "Programmable Capital" concept
sections:
  - component: NavBar
    position: top
    items: [Kairos logo, Docs link, GitHub link, Twitter link]
  - component: Hero3D
    position: center
    type: fullscreen
    background: ShaderGradient (purple/black animated 3D plane)
    overlay: Film grain texture
    content:
      - heading: "Programmable Capital."
      - subtitle: "Delegate authority without ownership. Verifiable on-chain."
      - cta_buttons:
          - label: "Launch App"
            href: "/dashboard"
            style: primary
          - label: "Documentation"
            href: "/docs"
            style: secondary
```

### Page: Dashboard Overview `/dashboard`

```yaml
route: "/dashboard"
file: apps/web/app/dashboard/page.tsx
layout: single column with cards
purpose: Portfolio summary, market snapshot, recent activity hub
shared_with: DashboardLayout (sticky nav + TerminalTicker)
data_source: usePaperTrading hook (localStorage, $10k initial)
sections:
  - component: StatCards
    position: top
    grid: 4 columns
    cards:
      - label: "Portfolio Value"
      - label: "Cash Balance"
      - label: "Unrealized PnL"
      - label: "Open Positions"
  - component: QuickActionCards
    position: below stats
    grid: 3 columns
    cards:
      - label: "New Trade"
        href: "/dashboard/trade"
      - label: "Portfolio"
        href: "/dashboard/portfolio"
      - label: "Delegations"
        href: "/dashboard/delegations"
  - component: TwoColumnGrid
    position: bottom
    columns:
      - component: MarketsCard
        data: BTC, ETH, XLM, SOL, ADA, XRP, DOGE prices + 24h change
        interaction: click navigates to /dashboard/trade?symbol=XXX
      - component: RecentTradesCard
        data: last 6 trades (buy/sell badge, asset, amount@price, PnL, timestamp)
        link: "[View All →]" to /dashboard/history
```

### Page: Trade `/dashboard/trade`

```yaml
route: "/dashboard/trade"
file: apps/web/app/dashboard/trade/page.tsx
layout: 2-column (main 2/3, sidebar 1/3)
purpose: Core trading — charting, AI analysis, manual execution, XLM delegation
data_source: Binance WS + HTTP, usePaperTrading, useMarketAnalysis
query_param: ?symbol=BTC (defaults to BTC)
sections:
  - component: SymbolStrip
    position: top (full width)
    items: BTC, ETH, XLM, SOL, ADA (each shows current price + 24h change)
    interaction: click selects symbol, updates chart + sidebar
  - component: MainColumn
    position: left (2/3 width)
    children:
      - component: PriceChart
        type: candlestick (lightweight-charts)
        features: interval selector [15m, 1H, 4H, 1D], WS live updates
      - component: PriceViewPanel
        data: VWAP, volatility, spread, avg volume, trend, momentum, risk badge, liquidity badge, AI confidence ring, AI market summary
        optional: RSI, EMA 20/50, MACD Hist (from AI proposal)
      - component: AIAnalysis
        features:
          automation_modes: [AI Managed, Strategy, Autonomous]
          textarea: trading intent (natural language)
          button: "Analyze" → POST /api/analyze
          result_card: action badge (Buy/Sell/Hold), confidence %, amount, ref price, SL, TP, reasoning, "Execute" button
  - component: Sidebar
    position: right (1/3 width)
    children:
      - component: QuickTrade
        features: Buy/Sell toggle, price display (flash on change), amount input, quick-fill [25%, 50%, 75%, 100%], estimated cost, cash balance, current holding
      - component: DelegationKit
        features: Freighter wallet connect, account display, balance, XLM send form with quick-amount chips
```

### Page: Portfolio `/dashboard/portfolio`

```yaml
route: "/dashboard/portfolio"
file: apps/web/app/dashboard/portfolio/page.tsx
layout: single column with mixed card grid
purpose: Position tracking, performance charts, activity log
data_source: usePaperTrading hook
sections:
  - component: StatCards
    position: top
    grid: 4 columns
    cards:
      - "Total Value"
      - "Cash Balance"
      - "Unrealized PnL"
      - "Realized PnL"
  - component: ChartsRow
    position: below stats
    grid: 2 columns
    columns:
      - component: EquityCurve
        type: area chart (Recharts)
        data: equity value over time
      - component: AllocationPie
        type: donut chart (Recharts)
        data: cash vs holdings percentages with legend
  - component: OpenPositionsTable
    columns: Asset, Amount, Entry Price, Mark Price, Value, PnL (with %)
    interaction: each row has [Close] button → calls closePosition
  - component: RecentActivity
    data: last 8 trades (buy/sell badge, asset, amount@price, PnL, timestamp)
    link: "[View All History →]" to /dashboard/history
```

### Page: History `/dashboard/history`

```yaml
route: "/dashboard/history"
file: apps/web/app/dashboard/history/page.tsx
layout: single column
purpose: Full trade log with filtering, sorting, pagination, CSV export
data_source: usePaperTrading trades
sections:
  - component: StatCards
    position: top
    grid: 4 columns
    cards:
      - "Total Trades"
      - "Win Rate (%)"
      - "Realized PnL"
      - "Total Fees"
  - component: FiltersCard
    position: below stats
    inputs:
      - type: text
        label: "Symbol"
        placeholder: "filter by asset"
      - type: dropdown
        label: "Action"
        options: [All, Buy, Sell]
    info: result count display
    action: [Export CSV] button
  - component: TradesTable
    columns: Time (sortable ▴), Symbol, Action (Badge), Amount, Price, PnL
    pagination: 12 per page, [← Prev] [Next →] buttons
```

### Page: Delegations `/dashboard/delegations`

```yaml
route: "/dashboard/delegations"
file: apps/web/app/dashboard/delegations/page.tsx
layout: 2-column
purpose: Smart wallet deployment and on-chain delegation management (Stellar/Soroban)
data_source: @stellar/freighter-api, POST /api/delegate-sdk
sections:
  - component: LeftColumn
    children:
      - component: DelegationKit
        features: Freighter connect, account display, XLM send (dest + amount + quick chips)
      - component: OnChainDelegationCard
        actions:
          - [Deploy Smart Wallet] → POST /api/delegate-sdk
          - [Create Delegation] (after deploy)
        output: smart wallet address, delegation hash
  - component: RightColumn
    children:
      - component: ActiveDelegations
        status: placeholder (future: list of delegations + policy editor)
  - component: ErrorBanner (shared)
    position: spans both columns
    condition: visible on error state
```

### Page: Settings `/settings`

```yaml
route: "/settings"
file: apps/web/app/settings/page.tsx
layout: single column, standalone (not in DashboardLayout)
purpose: User preferences, strategy params, paper trading controls
data_persistence: localStorage
sections:
  - component: Header
    items: ["← Dashboard" link (href: /dashboard), "Settings" title]
  - component: AutomationDefaultsCard
    fields:
      - "Default Mode": dropdown [AI Managed, Strategy, Autonomous]
      - "Default Symbol": dropdown [BTC, ETH, XLM, SOL, ADA]
  - component: StrategyParametersCard
    fields (number inputs):
      - "EMA Fast": default 12
      - "EMA Slow": default 26
      - "RSI Oversold": default 30
      - "RSI Overbought": default 70
  - component: PaperTradingCard
    fields:
      - "Fee": display 0.10%
      - "Slippage": display 0.05%
      - "Initial Balance": number input, default 10000
    action: [Reset Paper Wallet] with confirmation dialog
  - component: SaveButton
    position: bottom
    action: persists to localStorage
```

---

## Shared Layout: Dashboard Shell

```yaml
file: apps/web/app/dashboard/layout.tsx
routes_affected: /dashboard, /dashboard/trade, /dashboard/portfolio, /dashboard/history, /dashboard/delegations
structure:
  - component: StickyHeader
    items: [Kairos logo/name] + nav links
    nav_links:
      - label: "Overview"    href: "/dashboard"
      - label: "Trade"       href: "/dashboard/trade"
      - label: "Portfolio"   href: "/dashboard/portfolio"
      - label: "Delegations" href: "/dashboard/delegations"
      - label: "History"     href: "/dashboard/history"
      - label: "Settings"    href: "/settings"
    active_indicator: usePathname() matching
  - component: TerminalTicker
    type: auto-scrolling marquee
    data: live prices — BTC, ETH, XLM, SOL, ADA, XRP, DOGE
  - component: ContentSlot
    wrapper: max-w-7xl mx-auto with padding
    renders: page component via {children}
```

---

## Shared UI Components

| Component | File | Usage |
|---|---|---|
| `Card` | `components/ui/Card.tsx` | Bordered container + CardHeader, CardBody |
| `StatCard` | `components/ui/StatCard.tsx` | Label + large value + optional subtext + skeleton |
| `Badge` | `components/ui/Badge.tsx` | Inline badge: neutral, accent, success, error, warning, buy, sell |
| `Segmented` | `components/ui/Segmented.tsx` | Button group toggle (buy/sell, mode select) |
| `PriceChart` | `components/charts/PriceChart.tsx` | Candlestick chart (lightweight-charts) |
| `EquityCurve` | `components/charts/EquityCurve.tsx` | Area chart (Recharts) |
| `AllocationPie` | `components/charts/AllocationPie.tsx` | Donut chart (Recharts) |
| `PriceViewPanel` | `components/panels/PriceViewPanel.tsx` | Market analysis: VWAP, volatility, trend, risk, AI summary |
| `ConfidenceRing` | `components/panels/ConfidenceRing.tsx` | SVG circular progress (0-100%) |
| `DelegationKit` | `components/DelegationKit.tsx` | Freighter wallet + XLM send form |
| `TerminalTicker` | `components/TerminalTicker.tsx` | Scrolling price marquee |
