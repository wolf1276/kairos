# Kairos Frontend Architecture

## 1. System Context

```mermaid
C4Context
  title System Context — Kairos Frontend

  Person(User, "Trader / User", "Manages portfolio via web dashboard")
  System_Boundary(kairos, "Kairos Frontend (Next.js 16)") {
    System(ssr, "Server Components & API Routes", "RSC pages, REST API handlers")
    System(client, "Client Components", "React 19 client components, hooks, charts")
  }

  System_Ext(binanceRest, "Binance REST API", "24hr tickers, kline/candlestick data")
  System_Ext(binanceWS, "Binance WebSocket", "Real-time price streams")
  System_Ext(hf, "Hugging Face Inference API", "Mixtral-8x7B AI analysis & intent parsing")
  System_Ext(stellarRpc, "Stellar Soroban RPC", "Smart contract interactions")
  System_Ext(stellarHorizon, "Stellar Horizon", "Account balance & XLM queries")
  System_Ext(freighter, "Freighter Wallet", "Browser extension — identity & signing")

  Rel(User, client, "Interacts with")
  Rel(client, ssr, "Fetches data via fetch()")
  Rel(ssr, binanceRest, "GET /api/prices, /api/klines")
  Rel(client, binanceWS, "wss://stream.binance.com:9443/ws")
  Rel(ssr, hf, "POST — analysis & intent parsing")
  Rel(ssr, stellarRpc, "POST /api/delegate-sdk")
  Rel(client, freighter, "requestAccess / signTransaction")
  Rel(client, stellarHorizon, "Balance queries")
```

## 2. Route & Page Structure

```mermaid
flowchart TD
  Root["/ (RootLayout)"] --> Landing["page.tsx (Landing Page)"]
  Root --> DashLayout["/dashboard/layout.tsx (DashboardLayout)"]
  Root --> Settings["/settings/page.tsx (Settings)"]

  subgraph DashLayout["Dashboard Layout"]
    Header["Header: Logo + Nav"]
    Ticker["TerminalTicker (Marquee)"]
    Content["<main> Content Area"]
  end

  DashLayout --> Overview["/dashboard/page.tsx"]
  DashLayout --> Trade["/dashboard/trade/page.tsx"]
  DashLayout --> Portfolio["/dashboard/portfolio/page.tsx"]
  DashLayout --> History["/dashboard/history/page.tsx"]
  DashLayout --> Delegations["/dashboard/delegations/page.tsx"]

  subgraph API["API Routes (/api/)"]
    Analyze["POST /api/analyze"]
    Delegate["POST /api/delegate-sdk"]
    Intent["POST /api/intent/parse"]
    Klines["GET /api/klines"]
    PaperTrade["POST /api/paper-trade"]
    PortfolioAPI["GET /api/portfolio"]
    Prices["GET /api/prices"]
    Trades["GET /api/trades"]
  end

  Trade -.->|"calls"| Analyze
  Trade -.->|"calls"| Klines
  Trade -.->|"calls"| Prices
  Delegations -.->|"calls"| Delegate
  Portfolio -.->|"calls"| PortfolioAPI
  History -.->|"calls"| Trades

  Landing -->|"Launch App →"| DashLayout
```

## 3. Component Hierarchy

```mermaid
flowchart LR
  subgraph Legend["Legend"]
    direction LR
    L1["[Server]"]:::server
    L2["[Client]"]:::client
    L3("(Shared)"):::shared
  end

  classDef server fill:#1a1a2e,stroke:#4a4a8a,color:#fff
  classDef client fill:#2d1b3d,stroke:#7851e9,color:#fff
  classDef shared fill:#1a3d2e,stroke:#4a8a6a,color:#fff

  RL["RootLayout [Server]"]:::server --> LP["Landing Page [Client]"]:::client
  RL --> DL["DashboardLayout [Client]"]:::client
  RL --> SP["Settings [Client]"]:::client

  LP --> SG["ShaderGradient (Three.js)"]:::client
  LP --> Hero["Hero / CTA"]:::client

  DL --> H["Header"]:::client
  DL --> TT["TerminalTicker"]:::client
  DL --> PC["<Page Content>"]:::shared

  H --> Nav["Nav: Overview | Trade | Portfolio | Delegations | History | Settings"]:::client

  subgraph TT["TerminalTicker"]
    HP["usePrices → useBinanceWebSocket"]:::client
  end

  subgraph Overview["/dashboard (Overview)"]
    SC1["StatCard ×4"]:::client
    QA["Quick Actions ×3"]:::client
    Markets["Card: Markets (ticker list)"]:::client
    RecentTrades["Card: Recent Trades"]:::client
  end

  subgraph TradePage["/dashboard/trade"]
    SymStrip["Symbol Strip (BTC/ETH/XLM/SOL/ADA)"]:::client
    PC2["Card: PriceChart"]:::client
    PVP["Card: PriceViewPanel"]:::client
    AIBox["Card: AI Analysis"]:::client
    QT["Card: Quick Trade"]:::client
    DK["DelegationKit (Freighter)"]:::client

    PC2 --> LWC["lightweight-charts"]:::client
    PC2 --> SK["useStreamingKlines → Binance WS"]:::client

    PVP --> CR["ConfidenceRing (SVG)"]:::client
    PVP --> MA["useMarketAnalysis"]:::client

    AIBox --> Seg["Segmented (AI/Strategy/Autonomous)"]:::client
    AIBox --> AnalyzeBtn["Analyze → POST /api/analyze"]:::client
    AIBox --> Prop["Proposal Card"]:::client

    QT --> Seg2["Segmented (Buy/Sell)"]:::client
    QT --> AmtInput["Amount + 25/50/75/100%"]:::client

    DK --> FW["Freighter Wallet"]:::client
    DK --> Stellar["Stellar Horizon"]:::client
  end

  subgraph PortfolioPage["/dashboard/portfolio"]
    SC2["StatCard ×4"]:::client
    EC["Card: EquityCurve (Recharts)"]:::client
    AP["Card: AllocationPie (Recharts)"]:::client
    Positions["Card: Open Positions"]:::client
    Activity["Card: Recent Activity"]:::client
  end

  subgraph HistoryPage["/dashboard/history"]
    SC3["StatCard ×4"]:::client
    Filters["Filters: Symbol, Action, Export CSV"]:::client
    Tbl["Card: Sortable/Paginated Table"]:::client
  end

  subgraph DelegationsPage["/dashboard/delegations"]
    DK2["DelegationKit"]:::client
    OnChain["On-Chain Card"]:::client
    ActiveDel["Active Delegations (WIP)"]:::client
  end

  subgraph SettingsPage["/settings"]
    AutoDefaults["Card: Automation Defaults"]:::client
    StratParams["Card: Strategy Parameters"]:::client
    PaperReset["Card: Paper Trading Reset"]:::client
  end
```

## 4. Data Flow

```mermaid
flowchart TD
  subgraph External["External Services"]
    BW["Binance WebSocket\nwss://stream.binance.com:9443"]
    BR["Binance REST\napi.binance.com"]
    HF["Hugging Face\nMixtral-8x7B"]
    SR["Stellar Soroban RPC"]
    SH["Stellar Horizon"]
    FW["Freighter Wallet\n(Browser Extension)"]
  end

  subgraph Server["Next.js Server (API Routes)"]
    PricesAPI["GET /api/prices"]
    KlinesAPI["GET /api/klines"]
    AnalyzeAPI["POST /api/analyze"]
    IntentAPI["POST /api/intent/parse"]
    DelegateAPI["POST /api/delegate-sdk"]
    PaperAPI["POST /api/paper-trade"]
    PortfolioAPI["GET /api/portfolio"]
    TradesAPI["GET /api/trades"]
  end

  subgraph Client["Client-Side"]
    subgraph Hooks["Custom Hooks"]
    uBW["useBinanceWebSocket"]
    uSK["useStreamingKlines"]
    uP["usePrices"]
    uMA["useMarketAnalysis"]
    uPT["usePaperTrading"]
    end

    subgraph State["State Layer"]
    LS_Prices["localStorage\nkairos_paper_*"]
    LS_Settings["localStorage\nkairos_settings"]
    WS_Ref["useRef\nWebSocket instances"]
    end

    subgraph Components["UI Components"]
    Ticker["TerminalTicker"]
    PriceChart["PriceChart"]
    PriceView["PriceViewPanel"]
    TradeForm["Quick Trade"]
    Delegation["DelegationKit"]
    Overview["Overview / Portfolio / History"]
    end
  end

  BR --> PricesAPI
  PricesAPI --> uP

  BR --> KlinesAPI
  KlinesAPI --> uSK

  BW --> uBW
  uBW --> uP
  uP --> Ticker
  uP --> TradeForm

  uSK --> PriceChart

  uSK --> uMA
  uMA --> PriceView

  HF -->|"POST"| AnalyzeAPI
  AnalyzeAPI -->|"Proposal"| TradeForm

  FW -->|"requestAccess"| Delegation
  Delegation -->|"signTransaction"| FW
  Delegation --> DelegateAPI
  DelegateAPI --> SR

  SH --> Delegation

  uPT --> LS_Prices
  uPT --> Overview
  uPT --> TradeForm

  subgraph DataTypes["Data Types"]
    TickerData["24hr Ticker\n{symbol, price, change}"]
    CandleData["Candlestick\n{open, high, low, close, volume}"]
    Analysis["TradeProposal\n{direction, confidence, entry, stop, takeProfit}"]
    WalletState["WalletState\n{balance, positions, trades}"]
  end

  uP -.-> TickerData
  uSK -.-> CandleData
  AnalyzeAPI -.-> Analysis
  uPT -.-> WalletState
```

## 5. State Management

```mermaid
flowchart LR
  subgraph ExternalSources["External Data Sources"]
    BW["Binance WS"]
    BR["Binance REST"]
    HF["Hugging Face API"]
    SR["Soroban RPC"]
  end

  subgraph Hooks["Custom Hooks Layer"]
    H1["useBinanceWebSocket"]
    H2["usePrices"]
    H3["useStreamingKlines"]
    H4["useMarketAnalysis"]
    H5["usePaperTrading"]
  end

  subgraph StateStrategies["State Strategies"]
    S1["useState / useMemo\nLocal component state"]
    S2["useSyncExternalStore\nHydration-safe state"]
    S3["useRef\nWebSocket instances, RAF throttles"]
    S4["localStorage\nPersistent paper trading"]
  end

  subgraph UI["UI Components"]
    C1["TerminalTicker"]
    C2["PriceChart"]
    C3["PriceViewPanel + ConfidenceRing"]
    C4["Quick Trade Form"]
    C5["Portfolio / History"]
    C6["DelegationKit"]
  end

  BW --> H1
  H1 -->|"ticker map"| H2
  BR --> H2
  H2 -->|"{symbol→price,change}"| C1
  H2 -->|"current price"| C4

  BR --> H3
  H3 -->|"candle[]"| C2
  H3 -->|"candle[]"| H4

  H4 -->|"VWAP, vol, trend, risk, momentum"| C3

  H1 -.->|"useRef"| S3
  H2 -.->|"useSyncExternalStore"| S2
  H3 -.->|"useRef"| S3

  H5 -->|"useState + localStorage"| S4
  H5 -->|"WalletState"| C4
  H5 -->|"WalletState"| C5

  HF -->|"TradeProposal"| C4
  SR -->|"delegation status"| C6

  classDef green fill:#1a3d2e,stroke:#4a8a6a,color:#fff
  classDef purple fill:#2d1b3d,stroke:#7851e9,color:#fff
  classDef blue fill:#1a1a2e,stroke:#4a4a8a,color:#fff
  classDef amber fill:#3d2e1a,stroke:#8a6a4a,color:#fff

  class H1,H2,H3,H4,H5 green
  class C1,C2,C3,C4,C5,C6 purple
  class ExternalSources blue
  class S1,S2,S3,S4 amber
```

## 6. External Service Integration Map

| Service | Protocol | Endpoint | Used By | Data |
|---------|----------|----------|---------|------|
| **Binance REST** | HTTPS | `api.binance.com/api/v3/ticker/24hr`, `/klines` | Server API routes | Price snapshots, OHLCV candles |
| **Binance WebSocket** | WSS | `stream.binance.com:9443/ws` | Client hooks (`useBinanceWebSocket`, `useStreamingKlines`) | Real-time 24hr ticker updates, live kline streams |
| **Hugging Face** | HTTPS | `api-inference.huggingface.co/models/mistralai/Mixtral-8x7B-Instruct-v0.1` | Server API routes (`/api/analyze`, `/api/intent/parse`) | Trade proposals, intent parse results |
| **Stellar Soroban RPC** | HTTPS | `soroban-testnet.stellar.org` | Server API routes (`/api/delegate-sdk`) | Smart wallet deployment, delegation creation/execution |
| **Stellar Horizon** | HTTPS | `horizon-testnet.stellar.org` | Client (`app/lib/stellar.ts`) | Account balance, XLM transactions |
| **Freighter Wallet** | Browser Extension API | `window.freighter` | Client (`DelegationKit`, `stellar.ts`) | Wallet address, transaction signatures |
