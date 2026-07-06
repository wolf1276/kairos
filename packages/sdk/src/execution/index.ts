import { Address, Operation, rpc, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { KairosClient } from '../client';
import { Delegation, Execution, Signer, TransactionResult } from '../types';
import { RpcError, TransactionSimulationError } from '../errors';

// Soroban `Symbol` is limited to 32 ASCII characters drawn from [A-Za-z0-9_] — a function name
// outside that shape can't be a valid contract method, so it's rejected here before ever
// reaching `xdr.ScVal.scvSymbol` (whose own validation behavior isn't something callers should
// have to rely on for a client-side error message).
const VALID_SYMBOL = /^[A-Za-z0-9_]{1,32}$/;

/** Rejects a malformed execution request before any XDR is built — an execution with no target/
 *  function, an invalid target address, or an oversized/invalid function symbol would otherwise
 *  either throw a low-level stellar-sdk error deep inside XDR encoding or (worse) silently build
 *  a transaction that fails on-chain in a way that's hard to attribute back to the bad input. */
function validateExecution(exec: Execution, index: number): void {
  if (!exec.target) {
    throw new RpcError(`Execution[${index}]: target is required`);
  }
  try {
    Address.fromString(exec.target);
  } catch {
    throw new RpcError(`Execution[${index}]: invalid target address '${exec.target}'`);
  }
  if (!exec.function || !VALID_SYMBOL.test(exec.function)) {
    throw new RpcError(
      `Execution[${index}]: function name '${exec.function}' is not a valid Soroban Symbol (1-32 chars, [A-Za-z0-9_])`
    );
  }
  if (!Array.isArray(exec.args)) {
    throw new RpcError(`Execution[${index}]: args must be an array`);
  }
}

function validateDelegationChains(chains: Delegation[][]): void {
  if (chains.length === 0) {
    throw new RpcError('At least one delegation chain is required');
  }
  for (const chain of chains) {
    if (chain.length === 0) {
      throw new RpcError('Delegation chains must not be empty');
    }
  }
}

export class ExecutionModule {
  constructor(private client: KairosClient) {}

  /**
   * Executes one or more delegation executions on-chain. `redeemer` may be a local
   * `Keypair` or a `RemoteSigner` (e.g. an MPC-backed agent key) — either way, only the
   * redeemer's public key ever needs to be resolvable synchronously; signing itself may
   * be an async round-trip to a remote signer (see `KairosClient.submitTransaction`).
   */
  async execute(params: {
    redeemer: Signer;
    delegationChains: Delegation[][] | Delegation[];
    executions: Execution[] | Execution;
  }): Promise<TransactionResult> {
    // Normalize delegationChains
    let chains: Delegation[][];
    if (params.delegationChains.length > 0 && !Array.isArray(params.delegationChains[0])) {
      chains = [params.delegationChains as Delegation[]];
    } else {
      chains = params.delegationChains as Delegation[][];
    }

    // Normalize executions
    let execs: Execution[];
    if (!Array.isArray(params.executions)) {
      execs = [params.executions];
    } else {
      execs = params.executions;
    }

    if (execs.length === 0) {
      throw new RpcError('At least one execution is required');
    }
    // Validated before any network I/O — a malformed request fails fast instead of wasting an
    // RPC round-trip fetching the source account first.
    execs.forEach(validateExecution);
    validateDelegationChains(chains);

    const sourceAccount = await this.client.getAccount(params.redeemer.publicKey());

    const permissionContextsScVal = xdr.ScVal.scvVec(
      chains.map(chain =>
        xdr.ScVal.scvVec(
          chain.map(delegation => this.client.delegationToScVal(delegation))
        )
      )
    );

    const executionsScVal = xdr.ScVal.scvVec(
      execs.map(exec =>
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('args'),
            val: xdr.ScVal.scvVec(exec.args),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('function'),
            val: xdr.ScVal.scvSymbol(exec.function),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('target'),
            val: Address.fromString(exec.target).toScVal(),
          }),
        ])
      )
    );

    const redeemOp = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: 'redeem_delegations',
      args: [
        Address.fromString(params.redeemer.publicKey()).toScVal(),
        permissionContextsScVal,
        executionsScVal,
      ],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(redeemOp)
      .setTimeout(30)
      .build();

    // Submit transaction
    return this.client.submitTransaction(tx, params.redeemer);
  }

  /**
   * Simulates the execution.
   */
  async simulate(params: {
    redeemerAddress: string;
    delegationChains: Delegation[][] | Delegation[];
    executions: Execution[] | Execution;
  }): Promise<rpc.Api.SimulateTransactionResponse> {
    let chains: Delegation[][];
    if (params.delegationChains.length > 0 && !Array.isArray(params.delegationChains[0])) {
      chains = [params.delegationChains as Delegation[]];
    } else {
      chains = params.delegationChains as Delegation[][];
    }

    let execs: Execution[];
    if (!Array.isArray(params.executions)) {
      execs = [params.executions];
    } else {
      execs = params.executions;
    }

    if (execs.length === 0) {
      throw new RpcError('At least one execution is required');
    }
    execs.forEach(validateExecution);
    validateDelegationChains(chains);

    const sourceAccount = await this.client.getAccount(params.redeemerAddress);

    const permissionContextsScVal = xdr.ScVal.scvVec(
      chains.map(chain =>
        xdr.ScVal.scvVec(
          chain.map(delegation => this.client.delegationToScVal(delegation))
        )
      )
    );

    const executionsScVal = xdr.ScVal.scvVec(
      execs.map(exec =>
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('args'),
            val: xdr.ScVal.scvVec(exec.args),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('function'),
            val: xdr.ScVal.scvSymbol(exec.function),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('target'),
            val: Address.fromString(exec.target).toScVal(),
          }),
        ])
      )
    );

    const redeemOp = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: 'redeem_delegations',
      args: [
        Address.fromString(params.redeemerAddress).toScVal(),
        permissionContextsScVal,
        executionsScVal,
      ],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(redeemOp)
      .setTimeout(30)
      .build();

    return this.client.simulateTx(tx);
  }

  /**
   * Estimates resource consumption (gas, fee, events size) of the execution.
   */
  async estimateResources(params: {
    redeemerAddress: string;
    delegationChains: Delegation[][] | Delegation[];
    executions: Execution[] | Execution;
  }): Promise<{ cpuInstructions: number; memoryBytes: number; fee: string }> {
    const simResult = await this.simulate(params);
    if (!rpc.Api.isSimulationSuccess(simResult)) {
      throw new TransactionSimulationError(`Simulation failed: ${JSON.stringify(simResult)}`, simResult);
    }
    return {
      cpuInstructions: 0,
      memoryBytes: 0,
      fee: simResult.minResourceFee,
    };
  }

  /**
   * Wait for transaction confirmation.
   */
  async wait(txHash: string): Promise<TransactionResult> {
    return this.client.pollTransaction(txHash);
  }

  /**
   * Queries transaction/execution history.
   */
  async history(delegationHash: string): Promise<unknown[]> {
    return this.client.events.query({
      topicFilters: [
        {
          topics: [
            'redeemed',
            '*',
          ],
        },
      ],
    });
  }
}
