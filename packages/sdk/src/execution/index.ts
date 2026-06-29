import { Address, Keypair, Operation, Transaction, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { KairosClient } from '../client';
import { Delegation, Execution, TransactionResult } from '../types';

export class ExecutionModule {
  constructor(private client: KairosClient) {}

  /**
   * Executes one or more delegation executions on-chain.
   */
  async execute(params: {
    redeemer: Keypair;
    delegationChains: Delegation[][] | Delegation[];
    executions: Execution[] | Execution;
  }): Promise<TransactionResult> {
    const sourceAccount = await this.client.getAccount(params.redeemer.publicKey());
    
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
  }): Promise<any> {
    const sourceAccount = await this.client.getAccount(params.redeemerAddress);
    
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
    if (!simResult.minResourceFee) {
      throw new Error(`Simulation failed: ${JSON.stringify(simResult)}`);
    }
    return {
      cpuInstructions: Number(simResult.cost?.cpuInsns || 0),
      memoryBytes: Number(simResult.cost?.memBytes || 0),
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
  async history(delegationHash: string): Promise<any[]> {
    // Queries the RPC getEvents filter for the delegation hash
    return this.client.events.query({
      topicFilters: [
        {
          topics: [
            '*',
            delegationHash,
          ],
        },
      ],
    });
  }
}
