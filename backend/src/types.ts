export interface JsonSafeDelegation {
  delegate: string;
  delegator: string;
  authority: string;
  caveats: { enforcer: string; terms: number[] }[];
  salt: string;
  nonce: string;
  signature: string;
}

export interface DcaStrategyConfig {
  type: 'dca';
  token: string; // SEP-41 token contract address to spend (e.g. native XLM SAC)
  amountPerTick: string; // stroops, as a decimal string
  intervalSeconds: number; // minimum time between ticks for this agent
  // `destination` is always forced to the attached delegation's `delegator` (the smart wallet
  // itself) server-side — see agentService.setStrategy — regardless of what a client sends.
  // The agent's tick therefore never moves funds out of the wallet it was delegated by.
  destination: string;
}

export interface QuantStrategyConfig {
  type: 'quant';
  strategyId: string; // id into backend/src/strategies/index.ts's registry
  pair: string; // e.g. "XLM/USDC" — currently the only supported pair
  amountPerTrade: string; // stroops, as a decimal string
  intervalSeconds: number; // minimum time between ticks for this agent
  // `destination` is kept for type symmetry with DcaStrategyConfig even though quant trades
  // never move funds externally — the agent trades from its own account on the DEX. Forced
  // server-side to the delegator like DCA (see agentService.setStrategy).
  destination: string;
}

export type StrategyConfig = DcaStrategyConfig | QuantStrategyConfig;

export interface AgentSummary {
  id: string;
  owner: string;
  publicKey: string;
  status: string;
  delegationHash: string | null;
  /** The delegation's delegator (the smart wallet this agent is authorized to spend from). */
  delegator: string | null;
  strategy: StrategyConfig | null;
  lastTickAt: number | null;
  lastResult: string | null;
  lastError: string | null;
  createdAt: number;
}
