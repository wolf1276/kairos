// Real, unsigned, resource-assembled Soroban transaction builder for Aquarius Router calls.
// Additive to the existing real integration (`invocation.ts`/`realSorobanRpcClient.ts`) — does
// NOT change the ProtocolAdapter contract, `SorobanRpcClient` interface, or anything
// `production.ts` already wires up. Exists so a caller that wants the *actual* unsigned XDR (not
// just a simulation success/failure verdict) can get one, still without ever signing or
// submitting. Reuses the exact same operation-building logic (`buildRouterOperation`) the real
// adapter's own simulation path already uses, so the XDR this produces is built from the same
// real Soroban call the adapter already verified against live testnet (see invocation.ts's
// header comment).
import { rpc, Address, Operation, TransactionBuilder as StellarTransactionBuilder } from '@stellar/stellar-sdk';
import { buildRouterOperation, getNetworkPassphrase } from './invocation.js';
import type { InvocationOptions } from './invocation.js';
import type { AquariusNetwork } from './config.js';

export interface RealResourceEstimate {
  cpuInstructions: number;
  diskReadBytes: number;
  writeBytes: number;
  resourceFeeStroops: string;
  transactionSizeBytes: number;
}

export type RealTransactionDetail =
  | { success: true; unsignedXdr: string; resourceEstimate: RealResourceEstimate; simulationErrors: [] }
  | { success: false; unsignedXdr: null; resourceEstimate: null; simulationErrors: string[] };

/**
 * Builds a real router-call transaction, runs it through `simulateTransaction`, and — on success —
 * folds the simulation's resource footprint/fee data into the transaction via
 * `rpc.assembleTransaction` (the same step a real wallet/SDK performs before signing) so the
 * returned XDR is a genuinely submittable-shape unsigned transaction, not a bare skeleton. Never
 * signs (no secret key is used anywhere) and never calls `sendTransaction` — simulation only.
 */
export async function buildRealAquariusTransaction(
  routerContractId: string,
  method: string,
  args: Record<string, unknown>,
  network: AquariusNetwork,
  options: InvocationOptions,
): Promise<RealTransactionDetail> {
  const server = new rpc.Server(options.rpcUrl);
  const account = await server.getAccount(options.sourceAccountPublicKey);
  const operation = await buildRouterOperation(routerContractId, method, args, options.registry, options.sourceAccountPublicKey);
  const tx = new StellarTransactionBuilder(account, { fee: '10000000', networkPassphrase: getNetworkPassphrase(network) })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    return { success: false, unsignedXdr: null, resourceEstimate: null, simulationErrors: [rpc.Api.isSimulationError(sim) ? sim.error : 'unknown simulation error'] };
  }

  const assembled = rpc.assembleTransaction(tx, sim).build();
  const resources = sim.transactionData.build().resources();
  const unsignedXdr = assembled.toXDR();

  return {
    success: true,
    unsignedXdr,
    resourceEstimate: {
      cpuInstructions: resources.instructions(),
      diskReadBytes: resources.diskReadBytes(),
      writeBytes: resources.writeBytes(),
      resourceFeeStroops: sim.minResourceFee,
      transactionSizeBytes: Buffer.byteLength(unsignedXdr, 'base64'),
    },
    simulationErrors: [],
  };
}

/**
 * Verifies that a real, unsigned XDR string actually invokes the expected contract/function —
 * "unsigned XDR correctness". Parses the XDR (never trusts a field claiming to describe it) and
 * cross-checks the decoded invocation against what was requested. Used both defensively (reject a
 * forged/modified XDR before it's trusted) and for the "malformed XDR" / "invalid contract"
 * attack tests.
 */
export function verifyUnsignedXdr(unsignedXdr: string, network: AquariusNetwork, expectedContractId: string, expectedMethod: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  let parsed;
  try {
    parsed = StellarTransactionBuilder.fromXDR(unsignedXdr, getNetworkPassphrase(network));
  } catch (err) {
    return { ok: false, errors: [`XDR is not a well-formed transaction envelope: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (!('operations' in parsed) || parsed.operations.length !== 1) {
    return { ok: false, errors: ['XDR must contain exactly one operation'] };
  }
  const op = parsed.operations[0];
  if (op.type !== 'invokeHostFunction') {
    return { ok: false, errors: [`XDR operation type '${op.type}' is not 'invokeHostFunction'`] };
  }
  let invocation;
  try {
    invocation = (op as Operation.InvokeHostFunction).func.invokeContract();
  } catch (err) {
    return { ok: false, errors: [`XDR host function is not a contract invocation: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const contractId = Address.fromScAddress(invocation.contractAddress()).toString();
  const functionName = invocation.functionName().toString();
  if (contractId !== expectedContractId) errors.push(`XDR invokes contract '${contractId}' but '${expectedContractId}' was expected — possible invalid-contract attack`);
  if (functionName !== expectedMethod) errors.push(`XDR invokes function '${functionName}' but '${expectedMethod}' was expected`);
  return { ok: errors.length === 0, errors };
}
