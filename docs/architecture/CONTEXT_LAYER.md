# Context Layer

The Context Layer is the first layer of the Kairos AI Operating System. It produces one
immutable snapshot — `AgentContext` — representing everything an AI agent is authorized to know
about a specific agent at a specific point in time.

**The Context Layer never reasons, predicts, executes, or calls an LLM.** It only answers: *what
is true right now?*

Code: `backend/src/agentContext/`. Public surface: `backend/src/agentContext/index.ts`.

## Five domains

| Domain | File | Answers |
|---|---|---|
| Market | `domains/marketContext.ts` | price, oracle freshness, trend/momentum/volatility/volume/liquidity, regime |
| Managed Capital | `domains/capitalContext.ts` | capital under delegation, idle/deployable, allocations, protocol exposure, PnL, pending executions |
| Policy | `domains/policyContext.ts` | objective, risk profile, allowed assets/protocols, spend/position limits, delegation status |
| System | `domains/systemContext.ts` | oracle/scheduler/price-feed health, protocol/execution availability, feature flags |
| Historical | `domains/historicalContext.ts` | last execution/decision, recent failures, cooldown — bounded operational history, not memory |

Managed Capital and Policy deliberately hide blockchain implementation details (wallet addresses,
contract IDs, signatures, nonces, tx hashes) — an AI agent reasons like a portfolio manager, not a
blockchain client.

## Assembly: `contextBuilder.ts`

`buildAgentContext(agentId, options?)`:
1. Reads the agent row (`agentService.getAgentRow`) — one DB read.
2. Calls `featureEngine.buildFeatureResult` once — this is the only oracle/indicator computation
   in the whole build; every domain below reads from its result, none re-derive it.
3. Builds all five domain views from that single `FeatureBuildResult` + agent row.
4. Runs `validateAgentContext` (see below) and stamps the result into `context.validation`/`status`.
5. Computes `contextHash` (SHA-256 over the context with wall-clock-relative fields — `builtAt`,
   `computedAt`, every `*ageSeconds`/`remainingSeconds` — stripped first) and a random `snapshotId`.
6. Returns `Object.freeze(context)`.

`refreshAgentContext(agentId, options?)` forces a cache bypass (see below) — use after an event
that makes the cached FeatureSet stale before its TTL expires (e.g. a trade fill).

Returns `null` only when the agent doesn't exist or the oracle doesn't have enough candle history
yet — otherwise it always returns a context, even an invalid one (see Validation).

## Reproducibility

Two builds of the same underlying agent state + market snapshot produce the **same
`contextHash`**, regardless of which instant either build ran at — verified in
`__tests__/contextLayer.test.ts`. `snapshotId` is unique per build (for audit trails); `marketId`
(`"<pair>@<lastCandleTime>"`) is shared by every build against the same oracle snapshot.

## Validation (`validation.ts`)

Checked before a context is considered fit for any future AI layer:
- oracle freshness (age ≤ 900s)
- market price present and positive
- managed capital loaded (finite number)
- portfolio allocation complete
- a policy/role is assigned
- system reports the oracle healthy
- no protocol exposure without a corresponding allowed protocol

`status: 'valid' | 'invalid'` and `validation.errors[]` are always present on the context — an
invalid context is not thrown away, so the frontend debug viewer and audit trail can see *why* it
failed. **No future reasoning/decision/execution layer should act on a context where
`status !== 'valid'`.**

## Cache abstraction

`cache/index.ts` exposes `FeatureCacheProvider` (get/set/invalidate/clear/size). The default is
`InMemoryFeatureCacheProvider` (5s TTL). `featureEngine`/`contextBuilder` depend only on the
interface — swapping in a Redis-backed provider later is `setFeatureCacheProvider(new RedisProvider())`
with no call-site changes.

## API

`GET /api/agents/:id/context` (auth required, agent-owner-scoped) — `backend/src/routes/context.ts`.
Query params: `?refresh=true` (bypass cache), `?pair=XLM/USDC` (default pair).

## Frontend

`apps/web/app/dashboard/context/page.tsx` — a developer/debug panel reachable via the "Context"
nav item. Renders every field of the live `AgentContext` returned by the API above (agent picker,
snapshot metadata, all five domain cards, validation errors if any). No mock data — every value
comes straight from the backend response.

## Reused, not duplicated

Every number in a context comes from an existing service: `decisionEngine.buildMarketContext`
(oracle+indicators+base regime, called exactly once per cache miss), `portfolioService`,
`protocolPositionService`, `pnl.ts`, `tradeService`, `decisionService`, `auditService`,
`runner.isSchedulerRunning`, `priceFeed.isRunning`, `config.isProtocolExecutionEnabled`. No
indicator, PnL, or allocation math is recomputed inside `agentContext/`.

## What's explicitly out of scope here

No LLM calls, no agents, no memory/RAG, no strategy layer, no decision engine, no execution
changes, no SDK changes, no smart contract changes. This layer only prepares information.
