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
| **AI Managed Automation** | Large Language Model (LLM) decision engines that evaluate market dynamics and suggest actions based on your risk profile. |
| **Strategy Managed Automation** | Quantitative, rule-based algorithmic strategies executing preset technical models. |
| **Autonomous AI Sessions** | Time-bound, policy-restricted execution windows where AI engines optimize portfolio assets autonomously. |
| **Live Oracle** | Real-time, fast-updating asset prices streamed directly from major external exchanges. |
| **Paper Trading** | Zero-risk simulation sandbox to test trading profiles and strategies with historical and live data. |
| **Policy Engine** | Composable on-chain checks verifying period spend limits, asset whitelists, and contract boundaries. |
| **Non-Custodial Architecture** | Absolute safety of funds—assets never leave your delegated control, and AI agents never have direct access to your keys. |
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
        │Connect Wallet │  (Freighter Wallet Integration)
        └───────┬───────┘
                │
                ▼
  ┌───────────────────────────┐
  │ Create Delegation Wallet  │  (Isolate capital in a smart account)
  └─────────────┬─────────────┘
                │
                ▼
        ┌───────────────┐
        │Delegate Funds │  (Deposit capital & set policies on-chain)
        └───────┬───────┘
                │
                ▼
     ┌─────────────────────┐
     │ Choose Automation   │  (Select AI Managed, Strategy, or Autonomous)
     └──────────┬──────────┘
                │
                ▼
        ┌───────────────┐
        │    Analyze    │  (Indicator engine processes market snapshot)
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │   Decision    │  (LLM or quant engine proposes trade action)
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │  Paper Trade  │  (Verify proposals inside virtual sandbox)
        └───────┬───────┘
                │
                ▼
    [ Live Execution Coming Soon ]
```

---

## Automation Modes

### AI Managed
Leverages Natural Language Processing (NLP) to convert qualitative investment goals (e.g., *"Grow my portfolio with moderate risk, prioritizing Stellar ecosystem assets, and limit daily drawdowns to 2%"*) into structured `TradingProfile` objects. 
* **Intent Parsing:** High-fidelity semantic models parse natural language queries, identifying risk tolerance, investment horizon, allowed assets, and position limits.
* **Investment Plans:** Generates interactive plans, exposing safety guardrails and target metrics before deployment.

### Strategy Managed
Executes quantitative algorithms governed by rigid technical indicators. The strategy engine calculates standard mathematical indicators (e.g., RSI, MACD, EMA) to identify market opportunities and trigger transaction requests dynamically when parameters align.

### Autonomous AI
Initiates time-bound autonomous sessions where the Kairos Agent acts on your behalf.
* **Policy Enforcement:** Every transaction is verified on-chain against the delegation contract policies before submission.
* **Delegation Limits:** Absolute maximum spend limits, whitelist restrictions, and trade counters prevent the AI from draining funds or deviating from your guidelines.

---

## Architecture

```
                 ┌─────────────────────────────────┐
                 │          Live Oracle            │
                 └────────────────┬────────────────┘
                                  │ Market Price & Volatility
                                  ▼
                 ┌─────────────────────────────────┐
                 │         Market Snapshot         │
                 └────────────────┬────────────────┘
                                  │ Technical Indicators (RSI, MACD)
                                  ▼
                 ┌─────────────────────────────────┐
                 │         Decision Engine         │
                 └────────────────┬────────────────┘
                                  │ Trade Proposals (BUY / SELL / HOLD)
                                  ▼
                 ┌─────────────────────────────────┐
                 │      Paper Trading Engine       │
                 └────────────────┬────────────────┘
                                  │ Simulated Results / Performance Metrics
                                  ▼
                 ┌─────────────────────────────────┐
                 │       Delegation Manager        │
                 └────────────────┬────────────────┘
                                  │ Enforces Policies & Validates Nonce
                                  ▼
                 ┌─────────────────────────────────┐
                 │       Soroban smart contract    │
                 └─────────────────────────────────┘
```

### Architectural Layers
* **Oracle:** Periodically fetches raw candle and ticker data from source exchanges.
* **Market Snapshot:** Synthesizes raw data, running the `IndicatorEngine` to calculate technical analysis signals.
* **Decision Engine:** Evaluates snapshots using either quantitative strategies or LLM decision providers.
* **Paper Trading:** Evaluates decisions inside a virtual environment to monitor trading performance without risk.
* **Delegation Manager:** Handles off-chain signing, delegation verification, and target address whitelisting.
* **Soroban Contract:** On-chain runtime validating delegation policies and executing transaction payloads.

---

## Technology Stack

* **Next.js:** App Router-based frontend architecture.
* **TypeScript:** End-to-end type safety across the monorepo.
* **Stellar & Soroban:** High-performance, low-cost decentralized ledger and smart contract platform.
* **Freighter:** The official Stellar browser wallet extension for secure signature management.
* **Technical Indicators:** Mathematical indicator computation library for technical market analysis.
* **Binance Oracle:** Data feed integration for real-time cryptocurrency asset prices.
* **Paper Trading Engine:** In-memory trade execution system keeping virtual ledgers and portfolio states.

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
├── soroban-delegation/       # Soroban Rust contracts (Delegation Manager, Policies)
└── package.json              # Monorepo configuration and script definitions
```

---

## Getting Started

### Prerequisites

* Node.js `>=18.0.0`
* bun or npm installed

### Installation

Clone the repository and install the dependencies from the root directory:

```bash
# Install monorepo dependencies
npm install

# Build the SDK package
npm run build
```

### Running the Dashboard

Launch the Next.js development server:

```bash
# Navigate to the app directory
cd app

# Start the dev server
npm run dev
```

The web dashboard will be available at `http://localhost:3000`.

---

## Environment Variables

To run the Next.js app, configure a `.env.local` file inside the `app/` directory:

```env
# Next.js App Configurations
NEXT_PUBLIC_STELLAR_NETWORK=testnet

# Soroban Contract Registries (Deployed addresses)
NEXT_PUBLIC_DELEGATION_MANAGER_CONTRACT=CDWMR4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP
NEXT_PUBLIC_POLICY_ENGINE_CONTRACT=CCPENGINE4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP

# Optional AI Engine Key (for AI Intent Parsing)
OPENAI_API_KEY=your-openai-api-key-here
```

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
     │    ├── AI Intent Parsing & Policy Restrictor
     │    └── Basic Technical Indicator Calculations
     │
     └─► Future Phases
          ├── Live Trading execution on Stellar mainnet
          ├── Multi-Agent AI orchestration (collaborative portfolio optimization)
          ├── Advanced Deep ML Models for risk assessment
          ├── Comprehensive historical backtesting suite
          └── Real-time analytics dashboard & performance tracking
```

---

## Security

Kairos is architected with security as its primary primitive:
* **Assets Isolation:** User funds remain inside the user's personal smart Delegation Wallet contract. 
* **Zero Ownership:** Automated agents never take custody of keys or assets.
* **Immutable Policies:** Every trade execution is checked on-chain against policies (time, assets limit, daily volume cap) before a transfer is authorized.
* **Non-Custodial Design:** Users can withdraw capital or revoke delegation permissions at any moment directly on-chain.

---

## Screenshots

*Screenshots and UI visualizers of the Kairos Dashboard:*

### Dashboard Overview
![Dashboard Overview Placeholder](https://raw.githubusercontent.com/wolf1276/kairos/main/assets/dashboard-placeholder.png)

### Automation Selection
![Automation Selection Placeholder](https://raw.githubusercontent.com/wolf1276/kairos/main/assets/automation-placeholder.png)

### Investment Plan Review
![Investment Plan Placeholder](https://raw.githubusercontent.com/wolf1276/kairos/main/assets/plan-placeholder.png)

### Paper Trading Performance
![Paper Trading Performance Placeholder](https://raw.githubusercontent.com/wolf1276/kairos/main/assets/paper-trading-placeholder.png)

---

## Contributing

We welcome community contributions. To contribute:
1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature-name`.
3. Ensure all tests pass: `npm run test`.
4. Commit your changes with professional and descriptive commit messages.
5. Push to your fork and submit a Pull Request.

Please review our [CONTRIBUTING.md](file:///home/ahir/deployment/kairos_protocol/packages/sdk/CONTRIBUTING.md) inside the SDK package for standard guidelines.

---

## License

This project is licensed under the [MIT License](file:///home/ahir/deployment/kairos_protocol/packages/sdk/LICENSE).
