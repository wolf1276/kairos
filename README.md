# Kairos

Intent-Based Autonomous Capital Management on Stellar.

Kairos is a next-generation decentralized finance protocol designed to enable secure, non-custodial capital delegation on Stellar's Soroban smart contract platform. By shifting the paradigm from manual transaction execution to intent-based policy enforcement, Kairos allows users to delegate investment execution to automated algorithms and AI agents while maintaining absolute control over their assets.

---

## Why Kairos?

Traditional decentralized finance (DeFi) is highly manual and requires constant user interaction to rebalance portfolios, harvest yields, or execute trading strategies. Existing solutions like traditional trading bots suffer from major pain points:

* **High Trust Requirements:** Users must deposit funds into custodial contract accounts or share private keys with external bots.
* **Complex Automation:** Setting up complex condition-based strategies is highly technical and error-prone.
* **Lack of Guardrails:** Bots often lack sophisticated risk mitigation rules, risking entire user balances.

**Kairos resolves this by enabling intent-based execution.** Users delegate capital to dedicated smart contracts (Delegation Wallets) governed by highly customizable, on-chain execution policies. Automated providers or AI agents can make trade decisions on behalf of users, but those decisions must strictly conform to policies validated on-chain.

---

## Features

| Feature | Description |
| :--- | :--- |
| **Intent-Based Investing** | Declare natural language investment goals, automatically parsed into structured on-chain parameters. |
| **Delegation Wallets** | Dedicated custom smart accounts that house delegated capital and isolate execution risks. |
| **AI Managed Automation** | Hugging Face LLM (Mixtral-8x7B-Instruct) decision engine that evaluates market dynamics via the Hugging Face Inference API and suggests actions based on your risk profile. Falls back to deterministic RSI/MACD logic when the API is unavailable. |
| **Strategy Managed Automation** | Quantitative, rule-based algorithmic strategies executing preset technical models (EMA Crossover, Mean Reversion, Momentum). |
| **Autonomous AI Sessions** | Time-bound, policy-restricted execution windows where AI engines optimize portfolio assets autonomously. |
| **Live Oracle** | Real-time, fast-updating asset prices streamed directly from Binance (configurable timeframe, rate-limited). |
| **Paper Trading** | Zero-risk simulation sandbox to test trading profiles and strategies with live market data. Supports fees (0.1%) and slippage (0.05%). |
| **Policy Engine** | Composable on-chain checks verifying period spend limits (spend-limit), asset whitelists (target-whitelist), and time restrictions. |
| **Non-Custodial Architecture** | Absolute safety of funds — assets never leave your delegated control. All trade proposals are hard-gated by a deterministic policy engine before any execution. The LLM **never** determines position size or authorizes fund-moving actions. |
| **Soroban Native** | Purpose-built for Stellar's Soroban smart contract system, utilizing WASM execution and gas-efficient architectures. |

---

## How It Works

```
         ┌───────────────┐
         │     User      │
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────┐
         │Connect Wallet │  (Freighter Wallet)
         └───────┬───────┘
                 │
                 ▼
   ┌───────────────────────────┐
   │ Create Delegation Wallet  │  (CustomAccount smart contract)
   └─────────────┬─────────────┘
                 │
                 ▼
         ┌───────────────┐
         │  Set Intent   │  (Natural language → TradingProfile via HF or regex)
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────┐
         │  Choose Mode  │  (AI Managed / Strategy / Autonomous)
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────┐
         │   Analyze     │  (Oracle → Indicators → Decision Engine)
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────┐
         │ Policy Gate   │  (Hard enforcement: allowed assets, position caps, daily limits)
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────┐
         │ Execute       │  (On-chain via delegated redemption)
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────┐
         │  Portfolio    │  (Track performance, trades, balance)
         └───────────────┘
```

---

## Automation Modes

### AI Managed
Leverages the Hugging Face Inference API (Mixtral-8x7B-Instruct) to convert qualitative investment goals (e.g., *"Grow my portfolio with moderate risk, prioritizing Stellar ecosystem assets, and limit daily drawdowns to 2%"*) into structured `TradingProfile` objects.

* **Intent Parsing:** HF chat completion with JSON mode extracts risk tolerance, investment horizon, allowed assets, and position limits. Falls back to regex parsing when the API is unavailable.
* **Prompt Injection Hardening:** User text is treated as DATA, not instructions. The system prompt explicitly ignores embedded instructions.
* **Policy Gating:** All proposals are hard-gated by `applyPolicyGate()`, which enforces allowed assets, caps position size, and applies daily limits. The LLM never determines trade amounts.
* **Deterministic Fallback:** RSI + MACD analysis when the HF API is unavailable or all retries are exhausted (3 retries, exponential backoff).

### Strategy Managed
Executes quantitative algorithms governed by rigid technical indicators. The strategy engine calculates standard mathematical indicators (RSI, MACD, EMA) to identify market opportunities.
* **EMA Crossover:** Buy when EMA20 crosses above EMA50, sell on cross below.
* **Mean Reversion:** Buy when RSI < 30 (oversold), sell when RSI > 70 (overbought).
* **Momentum:** Buy on positive MACD histogram, sell on negative.

### Autonomous AI
Initiates time-bound autonomous sessions where the Kairos Agent acts on your behalf.

* **Policy Enforcement:** Every transaction is verified on-chain against the delegation contract policies before submission.
* **Delegation Limits:** Absolute maximum spend limits, whitelist restrictions, daily loss caps, and trade counters prevent the AI from draining funds or deviating from your guidelines.

---

## Architecture

```
                 ┌─────────────────────────────────┐
                 │     BinanceOracle (1h/1m/15m)   │
                 └────────────────┬────────────────┘
                                  │ Price, Volume, Change
                                  ▼
                 ┌─────────────────────────────────┐
                 │  IndicatorEngine                 │
                 │  (RSI, MACD, EMA20/50, ATR, SMA) │
                 └────────────────┬────────────────┘
                                  │ MarketSnapshot
                                  ▼
                 ┌─────────────────────────────────┐
                 │         DecisionEngine           │
                 │  ┌─────────────────────────┐     │
                 │  │ HfAdvisor (HF Inference) │     │
                 │  │ StrategyDecisionProvider │     │
                 │  │ AutonomousAIProvider     │     │
                 │  └─────────────────────────┘     │
                 └────────────────┬────────────────┘
                                  │ Raw Proposal (amount=0)
                                  ▼
                 ┌─────────────────────────────────┐
                 │         applyPolicyGate          │
                 │  (allowed assets, position cap,  │
                 │   daily limit, loss cap)         │
                 └────────────────┬────────────────┘
                                  │ Gated Proposal (amount set)
                                  ▼
                 ┌─────────────────────────────────┐
                 │     PaperTradingEngine          │
                 │  (per-wallet localStorage,      │
                 │   0.1% fee, 0.05% slippage)     │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │  delegate-sdk API → Kairos SDK   │
                 │  → DelegationManager Contract    │
                 └────────────────┬────────────────┘
                                  │ Enforces Policies & Validates Nonce
                                  ▼
                 ┌─────────────────────────────────┐
                 │     CustomAccount (Smart Wallet) │
                 └─────────────────────────────────┘
```

### Architectural Layers
* **Oracle:** Periodically fetches raw candle and ticker data from Binance. Configurable timeframe, rate-limited to 1 request/second.
* **Indicator Engine:** Synthesizes raw data with technical indicators (RSI, MACD, EMA, ATR, SMA).
* **Decision Engine:** Routes to the appropriate provider (HF AI, deterministic strategy, or autonomous AI) based on the user's automation mode.
* **Policy Gate:** The only component that determines position size. Enforces asset whitelists, position caps, daily limits, and loss caps. Cannot be bypassed by any provider.
* **Paper Trading:** Virtual execution environment with per-wallet state persistence, fees, and slippage.
* **Kairos SDK:** TypeScript client for interacting with deployed Soroban contracts.
* **CustomAccount:** On-chain smart wallet that validates all executions against delegation policies before authorizing transfers.

---

## Security Model

```
  ┌─────────────┐     ┌──────────────────┐     ┌────────────────────┐
  │  User Intent │────▶│   Policy Gate    │◀────│  LLM / Strategy   │
  │  → Profile   │     │  (hard boundary) │     │  (advisory only)  │
  └─────────────┘     └────────┬─────────┘     └────────────────────┘
                               │
                               ▼
                    ┌────────────────────┐
                    │ On-Chain Caveats   │
                    │ (spend-limit,      │
                    │  target-whitelist, │
                    │  time-restriction) │
                    └────────┬───────────┘
                             │
                             ▼
                    ┌────────────────────┐
                    │ DelegationManager  │
                    │ (nonce, replay     │
                    │  protection)       │
                    └────────┬───────────┘
                             │
                             ▼
                    ┌────────────────────┐
                    │ CustomAccount      │
                    │ (smart wallet,     │
                    │  no custody)       │
                    └────────────────────┘
```

**Key security properties:**
1. **LLM is advisory only** — It proposes actions but never sets amounts. `applyPolicyGate()` determines position size.
2. **Policy gate cannot be bypassed** — Every proposal passes through it, regardless of provider.
3. **On-chain caveats are final** — Even if the policy gate were compromised, on-chain spend limits and asset whitelists would block unauthorized transfers.
4. **Replay protection** — Monotonic nonces per delegator prevent replay attacks.
5. **Non-custodial** — The AI/strategy provider never has access to the user's private keys. All execution is via delegated redemption.

---

## Technology Stack

* **Next.js 16:** App Router-based frontend architecture.
* **TypeScript:** End-to-end type safety across the monorepo.
* **Stellar & Soroban:** High-performance, low-cost decentralized ledger and smart contract platform.
* **Freighter:** The official Stellar browser wallet extension for secure signature management.
* **Hugging Face Inference API:** AI intent parsing and advisory decisions via Mixtral-8x7B-Instruct.
* **Technical Indicators:** Mathematical indicator computation library for technical market analysis.
* **Binance Oracle:** Data feed integration for real-time cryptocurrency asset prices.
* **Paper Trading Engine:** Per-wallet simulated execution with fees, slippage, and localStorage persistence.

---

## Repository Structure

```
.
├── app/                      # Next.js web application (Dashboard & API)
│   ├── app/                  # Next.js App Router pages and globals
│   ├── components/           # Reusable UI component library (Shadcn-based)
│   ├── lib/                  # Core logic (Decision, Strategy, Paper Trading)
│   └── oracle/               # Price oracle and indicator calculator engines
├── packages/
│   └── sdk/                  # TypeScript SDK for interacting with Kairos contracts
├── soroban-delegation/       # Soroban Rust contracts (Delegation Manager, Policies, CustomAccount)
├── scripts/
│   ├── deploy-testnet.ts     # Deploy all contracts to Stellar testnet
│   ├── test-integration.ts   # SDK integration test against testnet
│   └── demo-e2e.ts           # Full end-to-end demo (intent → decision → on-chain)
├── config/
│   └── contracts.testnet.json # Deployed contract IDs
├── .env.example              # Environment variable documentation
├── README.md                 # This file
└── SECURITY.md               # Security guarantees and architecture
```

---

## Getting Started

### Prerequisites

* Node.js `>=18.0.0`
* pnpm

### Installation

```bash
# Install monorepo dependencies
pnpm install

# Build the SDK package
pnpm run build
```

### Environment Variables

Copy `.env.example` to `app/.env.local` and configure:

```bash
cp .env.example app/.env.local
```

Required variables:

| Variable | Description |
| :--- | :--- |
| `STELLAR_NETWORK` | `testnet` or `mainnet` |
| `STELLAR_RPC_URL` | Soroban RPC endpoint |
| `STELLAR_NETWORK_PASSPHRASE` | Network passphrase |
| `FUNDER_SECRET_KEY` | Funded testnet keypair secret for on-chain operations |
| `HUGGINGFACE_API_KEY` | Hugging Face Inference API token (optional — falls back to regex + deterministic logic) |

### Running the Dashboard

```bash
cd app
pnpm run dev
```

The dashboard will be available at `http://localhost:3000`.

### Deploying to Vercel

This is a pnpm monorepo — the Next.js app lives in `app/`. To deploy on Vercel:

1. **Import the repo** into Vercel.
2. **Set Root Directory** to `app/` in project settings (Settings → General → Root Directory).
3. **Add environment variables** listed in `.env.example` to your Vercel project.
4. **Deploy** — Vercel will install from root (resolving workspace deps) and build both the SDK and app.

The `vercel.json` at the repo root handles the build pipeline automatically.

### Running the Demo

```bash
# Deploy contracts (one-time)
npx tsx scripts/deploy-testnet.ts

# Run full e2e demo
export FUNDER_SECRET_KEY=SC…
npx tsx scripts/demo-e2e.ts
```

### Running Tests

```bash
# SDK unit tests
pnpm test

# Integration test (requires deployed contracts + funded key)
export FUNDER_SECRET_KEY=SC…
npx tsx scripts/test-integration.ts

# E2E Playwright tests
cd app
pnpm exec playwright test
```

---

## Deployed Contracts (Testnet)

| Contract | Address |
| :--- | :--- |
| DelegationManager | `CDYBWYJSAB2IPLCFTHIFCBSJRQS4E7D3L7KLTHG5QB2TRCMCSPYFNQN7` |
| PolicyEngine | `CB4KTGVNJUFMNH4MFF67MGYQ7IJ6ISD3KEBXYRWPDW25STSULCAZIY6R` |
| CustomAccount | `CDJPMMUAZRZGDA572NUV4CX4KQG2DOWG2SMTBSBGOD7WTRNRJ7WZDBVP` |

---

## Roadmap

```
  ┌────────────────────────────────────────────────────────┐
  │                        Roadmap                         │
  └────────────────────────────────────────────────────────┘
     │
     ├─► MVP (Current)
     │    ├── Soroban Delegation Framework
     │    ├── Paper Trading Simulator
     │    ├── Hugging Face AI Intent Parsing & Advisory
     │    ├── Policy-Gated Decision Engine
     │    └── Technical Indicator Calculations
     │
     └─► Future Phases
          ├── Live Trading on Stellar mainnet
          ├── Multi-Agent AI orchestration
          ├── Advanced ML risk assessment models
          ├── Historical backtesting suite
          └── Real-time analytics dashboard
```

---

## Security

Kairos is architected with security as its primary primitive. See [SECURITY.md](./SECURITY.md) for the full security model.

* **Assets Isolation:** User funds remain inside the user's personal smart Delegation Wallet contract.
* **Zero Ownership:** Automated agents never take custody of keys or assets.
* **AI is Advisory:** The LLM (Hugging Face) proposes actions but never determines position size. The policy gate is the sole authority for amounts.
* **Immutable Policies:** Every trade execution is checked on-chain against policies (time, asset whitelist, daily volume cap) before a transfer is authorized.
* **Non-Custodial Design:** Users can withdraw capital or revoke delegation permissions at any moment directly on-chain.

---

## Contributing

We welcome community contributions. To contribute:

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature-name`.
3. Ensure all tests pass: `pnpm test`.
4. Commit your changes with professional and descriptive commit messages.
5. Push to your fork and submit a Pull Request.

---

## License

This project is licensed under the [MIT License](./LICENSE).
