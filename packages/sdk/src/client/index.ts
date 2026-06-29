import { Address, Keypair, rpc, Transaction, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { NETWORKS } from '../config';
import { DelegationModule } from '../delegation';
import { EventsModule } from '../events';
import { ExecutionModule } from '../execution';
import { PolicyModule } from '../policy';
import { ContractConfig, NetworkConfig, TransactionResult, Delegation, Caveat } from '../types';
import { WalletModule } from '../wallet';

export class KairosClient {
  public readonly rpcProvider: rpc.Server;
  public readonly networkPassphrase: string;
  public readonly contracts: ContractConfig;

  public readonly wallet: WalletModule;
  public readonly delegation: DelegationModule;
  public readonly policy: PolicyModule;
  public readonly execution: ExecutionModule;
  public readonly events: EventsModule;

  constructor(config: {
    network?: 'testnet' | 'mainnet';
    rpcUrl?: string;
    networkPassphrase?: string;
    contracts: ContractConfig;
  }) {
    const netConfig = config.network ? NETWORKS[config.network] : undefined;
    const rpcUrl = config.rpcUrl || netConfig?.rpcUrl;
    if (!rpcUrl) {
      throw new Error('RPC URL is required. Provide config.network or config.rpcUrl.');
    }

    this.rpcProvider = new rpc.Server(rpcUrl);
    this.networkPassphrase = config.networkPassphrase || netConfig?.networkPassphrase || '';
    this.contracts = config.contracts;

    this.wallet = new WalletModule(this);
    this.delegation = new DelegationModule(this);
    this.policy = new PolicyModule(config.contracts.policyEngine);
    this.execution = new ExecutionModule(this);
    this.events = new EventsModule(this);
  }

  /**
   * Helper to retrieve Account instance from network.
   */
  async getAccount(addressStr: string): Promise<any> {
    try {
      return await this.rpcProvider.getAccount(addressStr);
    } catch (e) {
      // Return a basic mock/bare account if it doesn't exist yet on-chain (needed for simulation/tx building)
      const mockAccount: any = {
        accountId: addressStr,
        sequence: 0n,
      };
      return mockAccount;
    }
  }

  /**
   * Simulates a transaction.
   */
  async simulateTx(tx: Transaction): Promise<rpc.Api.SimulateTransactionResponse> {
    const response = await this.rpcProvider.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(response)) {
      return response;
    }
    if (rpc.Api.isSimulationRestore(response)) {
      throw new Error('Transaction simulation requires storage restoration (restore transaction needed)');
    }
    throw new Error(`Transaction simulation failed: ${response.error}`);
  }

  /**
   * Submits a transaction to the network.
   */
  async submitTransaction(tx: Transaction, signer: Keypair): Promise<TransactionResult> {
    // 1. Simulate the transaction to auto-fill footprints and resource fees
    let simRes: rpc.Api.SimulateTransactionSuccessResponse;
    try {
      const sim = await this.simulateTx(tx);
      simRes = sim as rpc.Api.SimulateTransactionSuccessResponse;
    } catch (err: any) {
      return {
        hash: '',
        status: 'FAILED',
        error: err.message || 'Simulation failed',
      };
    }

    // 2. Assemble the transaction using the simulation result
    const assembledTx = rpc.assembleTransaction(tx, simRes).build();
    
    // 3. Sign the transaction
    assembledTx.sign(signer);

    // 4. Send the transaction
    const sendResponse = await this.rpcProvider.sendTransaction(assembledTx);
    if (sendResponse.status === 'ERROR') {
      return {
        hash: sendResponse.hash || '',
        status: 'FAILED',
        error: (sendResponse as any).errorResultXdr || (sendResponse as any).errorResult || 'Send transaction failed',
      };
    }

    // 5. Poll the transaction for final result
    return this.pollTransaction(sendResponse.hash);
  }

  /**
   * Polls Soroban RPC for the transaction confirmation.
   */
  async pollTransaction(hash: string, maxAttempts = 10, intervalMs = 2000): Promise<TransactionResult> {
    for (let i = 0; i < maxAttempts; i++) {
      const res = await this.rpcProvider.getTransaction(hash);
      if (res.status === 'SUCCESS') {
        const xdrStr = res.resultXdr && typeof res.resultXdr !== 'string' ? (res.resultXdr as any).toXDR('base64') : res.resultXdr;
        return {
          hash,
          status: 'SUCCESS',
          ledger: res.ledger,
          resultXdr: xdrStr,
        };
      }
      if (res.status === 'FAILED') {
        const xdrStr = res.resultXdr && typeof res.resultXdr !== 'string' ? (res.resultXdr as any).toXDR('base64') : res.resultXdr;
        return {
          hash,
          status: 'FAILED',
          error: xdrStr || 'Transaction execution failed',
        };
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return {
      hash,
      status: 'PENDING',
    };
  }

  /**
   * Reads instance/persistent storage of a contract.
   */
  async readInstanceStorage(contractId: string, keyName: string): Promise<xdr.ScVal | null> {
    const keyScVal = xdr.ScVal.scvSymbol(keyName);
    const ledgerKey = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: Address.fromString(contractId).toScAddress(),
        key: keyScVal,
        durability: xdr.ContractDataDurability.persistent(),
      })
    );

    const res = await this.rpcProvider.getLedgerEntries(ledgerKey);
    if (res.entries && res.entries.length > 0) {
      const val = res.entries[0].val.contractData().val();
      return val;
    }
    return null;
  }

  /**
   * Helper to convert hex string to BytesN<32> ScVal.
   */
  hexToBytesN32ScVal(hexStr: string): xdr.ScVal {
    const buffer = Buffer.from(hexStr, 'hex');
    if (buffer.length !== 32) {
      throw new Error(`BytesN<32> requires exactly 32 bytes. Received: ${buffer.length}`);
    }
    return xdr.ScVal.scvBytes(buffer); // Soroban BytesN matches raw scvBytes or scvVec of bytes depending on SDK
  }

  /**
   * Helper to convert hex string to BytesN<64> ScVal.
   */
  hexToBytesN64ScVal(hexStr: string): xdr.ScVal {
    const buffer = Buffer.from(hexStr, 'hex');
    if (buffer.length !== 64) {
      throw new Error(`BytesN<64> requires exactly 64 bytes. Received: ${buffer.length}`);
    }
    return xdr.ScVal.scvBytes(buffer);
  }

  /**
   * Serializes a TS Delegation object into a ScVal representation matching the contract's struct.
   */
  delegationToScVal(delegation: Delegation): xdr.ScVal {
    return xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('authority'),
        val: this.hexToBytesN32ScVal(delegation.authority),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('caveats'),
        val: xdr.ScVal.scvVec(
          delegation.caveats.map((c: Caveat) => 
            xdr.ScVal.scvMap([
              new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('enforcer'),
                val: Address.fromString(c.enforcer).toScVal(),
              }),
              new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('terms'),
                val: xdr.ScVal.scvBytes(Buffer.from(c.terms)),
              }),
            ])
          )
        ),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('delegate'),
        val: Address.fromString(delegation.delegate).toScVal(),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('delegator'),
        val: Address.fromString(delegation.delegator).toScVal(),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('nonce'),
        val: xdr.ScVal.scvU64(new xdr.Uint64(delegation.nonce)),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('salt'),
        val: xdr.ScVal.scvU64(new xdr.Uint64(delegation.salt)),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('signature'),
        val: this.hexToBytesN64ScVal(delegation.signature),
      }),
    ]);
  }

  /**
   * Helper to parse base64 ScVal string to ScVal object.
   */
  parseScVal(xdrBase64: string): xdr.ScVal {
    return xdr.ScVal.fromXDR(Buffer.from(xdrBase64, 'base64'));
  }

  /**
   * Extracts contract ID from a createContract operation result XDR.
   */
  extractContractId(resultXdrBase64: string): string | null {
    try {
      const res = xdr.TransactionResult.fromXDR(Buffer.from(resultXdrBase64, 'base64'));
      const contractIdBytes = (res.result().results()[0].tr() as any).createContractResult().contractId();
      return contractIdBytes.toString('hex');
    } catch {
      return null;
    }
  }
}
