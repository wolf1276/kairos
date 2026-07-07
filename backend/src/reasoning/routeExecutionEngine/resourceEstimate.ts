// Synthetic fallback resource estimation and XDR encoding — used only for a protocol with no
// `RealTransactionProvider` registered (see `types.ts: RealTransactionProvider`, `engine.ts`).
// Real Soroban integration exists for Aquarius
// (`protocolAdapters/aquarius/realTransactionBuilder.ts`, live-testnet-verified); other protocols
// have no equivalent yet, so this fallback keeps the pipeline replayable/hashable rather than
// failing closed over a missing "nice to have". Every `ExecutionResult` records which path was
// used via `metadata.dataSource` — never silently mixed with real data.
import { stableStringify } from '../../stableStringify.js';
import type { TransactionBuilder } from '../../protocolAdapters/types.js';
import type { ResourceEstimate } from './types.js';

const BASE_CPU_INSTRUCTIONS = 1_000_000;
const CPU_INSTRUCTIONS_PER_ARG_BYTE = 50;
const BASE_READ_BYTES = 4_096;
const READ_BYTES_PER_ARG_BYTE = 2;
const BASE_WRITE_BYTES = 1_024;
const WRITE_BYTES_PER_ARG_BYTE = 1;
const BASE_TX_SIZE_BYTES = 200;
const SYNTHETIC_RESOURCE_FEE_STROOPS = '100000';

function argsSizeBytes(tx: TransactionBuilder): number {
  return Buffer.byteLength(stableStringify(tx.args), 'utf8');
}

/** Purely a function of the transaction's own shape (method + arg payload size) — identical
 *  transactions always produce an identical estimate, and no adapter/network call is made here.
 *  NOT a real Soroban resource footprint — see the file header. */
export function computeSyntheticResourceEstimate(tx: TransactionBuilder): ResourceEstimate {
  const size = argsSizeBytes(tx);
  return {
    cpuInstructions: BASE_CPU_INSTRUCTIONS + size * CPU_INSTRUCTIONS_PER_ARG_BYTE,
    diskReadBytes: BASE_READ_BYTES + size * READ_BYTES_PER_ARG_BYTE,
    writeBytes: BASE_WRITE_BYTES + size * WRITE_BYTES_PER_ARG_BYTE,
    resourceFeeStroops: SYNTHETIC_RESOURCE_FEE_STROOPS,
    transactionSizeBytes: BASE_TX_SIZE_BYTES + size,
  };
}

/** A deterministic, base64-encoded, canonical-JSON stand-in for a real Stellar/Soroban XDR
 *  envelope. NOT a real XDR encoding. Always derived by the engine itself from an
 *  already-integrity-checked `TransactionBuilder`, never accepted as external input — this is
 *  what makes a "modified XDR" attack structurally impossible on the synthetic path: there is no
 *  code path that takes an XDR string from a caller and trusts it. */
export function encodeSyntheticXdr(tx: TransactionBuilder): string {
  return Buffer.from(stableStringify(tx), 'utf8').toString('base64');
}
