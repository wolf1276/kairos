# @kairos/types

Shared TypeScript types for the Kairos agent/trading **backend** and the **dashboard**. This package is the single source of truth for the shapes that cross the backend REST boundary — agents, trades, positions, audit rows, decisions, performance snapshots, and portfolio/dashboard views.

> [!NOTE]
> This is a **source-only** package: `main` and `types` both point at [`src/index.ts`](./src/index.ts) — there is no build step and no `dist/`. It is `private` (not published) and has no dependencies. Consumers import it directly through the pnpm workspace.

> [!IMPORTANT]
> `@kairos/types` is **distinct from the SDK's own `types` module** ([`packages/sdk/src/types`](../sdk/README.md)). This package models the **backend/runtime and database rows** (e.g. `TradeRow`, `AuditLogRow`); the SDK's `types` model **on-chain contract structures** (e.g. `Delegation`, `Caveat`, `Execution`). The one deliberate bridge is `JsonSafeDelegation`, a JSON-round-trippable form of the SDK's `Delegation` (bigints as strings, `terms` as `number[]`).

## Consumers

| Consumer | Uses it for |
| :--- | :--- |
| [`backend/`](../../backend/README.md) | DB row types, REST response shapes, agent/strategy/decision models. |
| [`apps/web/`](../../apps/web/README.md) | Typing the agent-backend HTTP client and dashboard views. |

## Type domains

All exports live in [`src/index.ts`](./src/index.ts).

| Domain | Types |
| :--- | :--- |
| **Strategy configs** | `DcaStrategyConfig`, `QuantStrategyConfig`, `LimitStrategyConfig`, `RoleStrategyConfig`, and the discriminated union `StrategyConfig`. |
| **Agent** | `AgentMode` (`paper \| live`), `AgentRole` (`yield \| strategic \| balancer`), `AgentStatus` (`new \| running \| stopped \| error`), `AgentSummary`. |
| **Trades** | `TradeSide` (`buy \| sell`), `TradeStatus` (`success \| failed`), `TradeRow` (snake_case DB row). |
| **Positions** | `PositionSide` (`long`), `PositionRow`. |
| **Audit** | `AuditEventType` (19 event types, e.g. `trade_executed`, `policy_violation`, `decision_made`), `AuditLogRow`. |
| **Decisions** | `DecisionRecord` — the full replayable decision row, including LLM fields (`llm_model`, `llm_prompt_summary`, `llm_response_json`) and validation JSON blobs. |
| **Performance** | `PerformanceSnapshot`. |
| **Delegation** | `JsonSafeDelegation` — JSON-safe delegation (see note above). |
| **P&L / Yield / Portfolio / Dashboard** | `PnlSummary`, `YieldVenue`, `PortfolioOverview`, `AgentDashboard`. |

## Usage

```ts
import type { AgentSummary, TradeRow, StrategyConfig } from '@kairos/types';
```

## Related

- [`packages/sdk`](../sdk/README.md) — on-chain contract types (`Delegation`, `Caveat`, …).
- [`backend`](../../backend/README.md) — primary producer of these shapes.
- [`apps/web`](../../apps/web/README.md) — primary consumer over HTTP.
