// Real, unsigned, resource-assembled Soroban transaction builder for Blend (`submit`) — same
// technique as `phoenix/realTransactionBuilder.ts`. See `invocation.ts`'s header for the
// live-testnet-deployment verification (unlike Phoenix, a real Blend testnet deployment exists).
import { Address, Operation, rpc, TransactionBuilder as StellarTransactionBuilder } from '@stellar/stellar-sdk';
import { buildBlendOperation, getNetworkPassphrase } from './invocation.js';
import type { InvocationOptions } from './invocation.js';
import type { BlendNetwork } from './config.js';
import type { BlendAction } from './types.js';

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

export async function buildRealBlendTransaction(
  contractId: string,
  action: BlendAction,
  args: Record<string, unknown>,
  network: BlendNetwork,
  options: InvocationOptions,
): Promise<RealTransactionDetail> {
  const server = new rpc.Server(options.rpcUrl);
  const account = await server.getAccount(options.sourceAccountPublicKey);
  const operation = buildBlendOperation(contractId, action, args, options);
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

export function verifyUnsignedXdr(unsignedXdr: string, network: BlendNetwork, expectedContractId: string, expectedMethod = 'submit'): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  let parsed;
  try {
    parsed = StellarTransactionBuilder.fromXDR(unsignedXdr, getNetworkPassphrase(network));
  } catch (err) {
    return { ok: false, errors: [`XDR is not a well-formed transaction envelope: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (!('operations' in parsed) || parsed.operations.length !== 1) return { ok: false, errors: ['XDR must contain exactly one operation'] };
  const op = parsed.operations[0];
  if (op.type !== 'invokeHostFunction') return { ok: false, errors: [`XDR operation type '${op.type}' is not 'invokeHostFunction'`] };
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
