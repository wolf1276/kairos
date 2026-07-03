export interface JsonSafeDelegation {
  delegate: string;
  delegator: string;
  authority: string;
  caveats: { enforcer: string; terms: number[] }[];
  salt: string;
  nonce: string;
  signature: string;
}

export interface DelegationRecord {
  hash: string;
  disabled: boolean;
  delegator: string;
  full?: JsonSafeDelegation;
}

export interface DelegationStats {
  activeCount: number;
  totalValue: number;
  activeAgents: number;
  policiesAttached: number;
  revokedCount: number;
  pendingRequests: number;
}

export type DelegationStatus = 'active' | 'disabled' | 'pending' | 'expired';

export type DelegationSort = 'newest' | 'oldest' | 'value' | 'activity';

export interface DelegationFilters {
  search: string;
  status: DelegationStatus | 'all';
  asset: string;
  sort: DelegationSort;
}

export interface CaveatPolicy {
  type: 'target-whitelist' | 'spend-limit' | 'time-restriction';
  label: string;
  description: string;
}

export const POLICY_DEFINITIONS: CaveatPolicy[] = [
  {
    type: 'target-whitelist',
    label: 'Target Whitelist',
    description: 'Restricts which contract or account addresses the delegation can interact with',
  },
  {
    type: 'spend-limit',
    label: 'Spend Limit',
    description: 'Caps the total spend amount over a rolling time window',
  },
  {
    type: 'time-restriction',
    label: 'Time Restriction',
    description: 'Limits execution to a specific date/time window',
  },
];

export type ActivityEventType = "created" | "revoked" | "enabled" | "executed";

export interface ActivityEvent {
  id: string;
  delegationHash: string;
  type: ActivityEventType;
  timestamp: number;
  details?: string;
  txHash?: string;
}

export interface DelegationTemplate {
  id: string;
  name: string;
  description: string;
  policies: { type: string; label: string }[];
  risk: "low" | "moderate" | "high";
}

export const DELEGATION_TEMPLATES: DelegationTemplate[] = [
  {
    id: "basic-trading",
    name: "Basic Trading",
    description: "Allow trading with daily spend limit and time restriction",
    policies: [
      { type: "spend-limit", label: "$1,000 daily limit" },
      { type: "time-restriction", label: "Active 30 days" },
    ],
    risk: "low",
  },
  {
    id: "defi-yield",
    name: "DeFi Yield",
    description: "Deposit into protocols with moderate limits",
    policies: [
      { type: "target-whitelist", label: "Whitelisted protocols only" },
      { type: "spend-limit", label: "$5,000 daily limit" },
      { type: "time-restriction", label: "Active 90 days" },
    ],
    risk: "moderate",
  },
  {
    id: "full-agent",
    name: "Full Agent Access",
    description: "Full trading autonomy with high limits and long duration",
    policies: [
      { type: "target-whitelist", label: "Specific contract only" },
      { type: "spend-limit", label: "$10,000 daily limit" },
      { type: "time-restriction", label: "Active 180 days" },
    ],
    risk: "high",
  },
];

export const DELEGATION_MOCK: DelegationRecord[] = [
  {
    hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1',
    disabled: false,
    delegator: 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456',
  },
  {
    hash: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    disabled: true,
    delegator: 'GBCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567',
  },
  {
    hash: 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3',
    disabled: false,
    delegator: 'GCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678',
  },
];
