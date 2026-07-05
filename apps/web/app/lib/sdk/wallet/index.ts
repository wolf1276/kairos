// Wallet-side SDK wrappers, split by concern so this stays a thin barrel instead of one giant
// file. Only `accounts` (funder keypair) and `deployment` (sponsored deploy) exist today —
// add sibling modules here as new wallet features land, e.g.:
//   policies.ts     — spend-limit / whitelist policy wiring for a deployed wallet
//   permissions.ts  — delegation grant/revoke wiring
//   recovery.ts     — owner-key rotation / social recovery
// Each would export its own thin wrappers around packages/sdk's modules, same shape as
// deployment.ts, and get re-exported below.
export * from "./accounts";
export * from "./deployment";
