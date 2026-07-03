import { Address, Keypair, rpc, Transaction, TransactionBuilder, xdr, Account, StrKey } from '@stellar/stellar-sdk';
import { NETWORKS } from '../config';
import { DelegationModule } from '../delegation';
import { EventsModule } from '../events';
import { ExecutionModule } from '../execution';
import { PolicyModule } from '../policy';
import { ContractConfig, NetworkConfig, TransactionResult, Delegation, Caveat, Signer } from '../types';
import { WalletModule } from '../wallet';
import { RpcError, TransactionSimulationError } from '../errors';
import { signTransaction } from '../utils';



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
      throw new RpcError('RPC URL is required. Provide config.network or config.rpcUrl.');
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
  async getAccount(addressStr: string): Promise<Account> {
    try {
      return await this.rpcProvider.getAccount(addressStr);
    } catch (e) {
      // Return a basic bare account if it doesn't exist yet on-chain (needed for simulation/tx building)
      return new Account(addressStr, '0');
    }
  }

  /**
   * Polls Soroban RPC until an account is visible on-chain, retrying while a freshly
   * funded (e.g. via Friendbot) account propagates. Unlike `getAccount`, this throws
   * instead of silently returning a bare sequence-0 account, since callers building a
   * transaction need a real, signable source account.
   */
  async waitForAccount(addressStr: string, opts: { maxAttempts?: number; intervalMs?: number } = {}): Promise<Account> {
    const { maxAttempts = 10, intervalMs = 2000 } = opts;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.rpcProvider.getAccount(addressStr);
      } catch (e) {
        if (attempt === maxAttempts) {
          throw new RpcError(`Account ${addressStr} not found on-chain after ${maxAttempts} attempts. Fund it first (e.g. via Friendbot on testnet).`);
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
    // Unreachable, but keeps TypeScript's control-flow analysis happy.
    throw new RpcError(`Account ${addressStr} not found on-chain.`);
  }

  /**
   * Funds a testnet account via Friendbot, retrying on transient failures
   * (Friendbot is best-effort and occasionally times out or 5xxs under load).
   */
  async fundTestnetAccount(addressStr: string, opts: { maxAttempts?: number; intervalMs?: number } = {}): Promise<void> {
    const { maxAttempts = 5, intervalMs = 3000 } = opts;
    let lastError: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(addressStr)}`);
        if (res.ok) return;
        lastError = `Friendbot responded with status ${res.status}`;
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'Unknown Friendbot error';
      }
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
    throw new RpcError(`Failed to fund testnet account ${addressStr} via Friendbot: ${lastError}`);
  }

  /**
   * Ensures an account exists on-chain, funding it via Friendbot first if it's missing.
   * No-op (besides the existence check) once the account is already funded.
   */
  async ensureFundedTestnetAccount(addressStr: string): Promise<Account> {
    try {
      return await this.waitForAccount(addressStr, { maxAttempts: 1 });
    } catch {
      await this.fundTestnetAccount(addressStr);
      return this.waitForAccount(addressStr, { maxAttempts: 10, intervalMs: 2000 });
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
      throw new TransactionSimulationError(
        'Transaction simulation requires storage restoration (restore transaction needed)',
        response
      );
    }
    throw new TransactionSimulationError(
      `Transaction simulation failed: ${response.error}`,
      response
    );
  }

  /**
   * Submits a transaction to the network.
   */
  async submitTransaction(tx: Transaction, signer: Signer): Promise<TransactionResult> {
    const localTx = TransactionBuilder.fromXDR(tx.toXDR(), this.networkPassphrase) as Transaction;

    // 1. Simulate the transaction to auto-fill footprints and resource fees
    let simRes: rpc.Api.SimulateTransactionSuccessResponse;
    try {
      const sim = await this.simulateTx(localTx);
      simRes = sim as rpc.Api.SimulateTransactionSuccessResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Simulation failed';
      return {
        hash: '',
        status: 'FAILED',
        error: msg,
      };
    }

    // 2. Assemble the transaction using the simulation result
    const assembled = rpc.assembleTransaction(localTx, simRes);
    let finalTx = assembled.build();

    // 3. Sign the transaction
    await signTransaction(finalTx, signer);

    // 4. Send the transaction
    const sendResponse = await this.rpcProvider.sendTransaction(finalTx);
    if (sendResponse.status === 'ERROR') {
      return {
        hash: sendResponse.hash,
        status: 'FAILED',
        error: `Send transaction failed with status: ERROR`,
      };
    }

    // 5. Poll the transaction for final result
    return this.pollTransaction(sendResponse.hash);
  }

  /**
   * Polls Soroban RPC for the transaction confirmation.
   */
  async pollTransaction(hash: string, maxAttempts = 30, intervalMs = 2000): Promise<TransactionResult> {
    const rpcUrl = String(this.rpcProvider.serverURL);
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTransaction',
            params: { hash },
          }),
        });
        const json = await response.json() as { result?: { status: string; ledger?: number; resultXdr?: string; error?: string } };
        if (json.result) {
          const res = json.result;
          if (res.status === 'SUCCESS') {
            return {
              hash,
              status: 'SUCCESS',
              ledger: res.ledger,
              resultXdr: res.resultXdr,
            };
          }
          if (res.status === 'FAILED') {
            return {
              hash,
              status: 'FAILED',
              error: res.resultXdr || 'Transaction execution failed',
            };
          }
        }
      } catch {
        // not ready yet, continue polling
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
      throw new RpcError(`BytesN<32> requires exactly 32 bytes. Received: ${buffer.length}`);
    }
    return xdr.ScVal.scvBytes(buffer);
  }

  /**
   * Helper to convert hex string to BytesN<64> ScVal.
   */
  hexToBytesN64ScVal(hexStr: string): xdr.ScVal {
    const buffer = Buffer.from(hexStr, 'hex');
    if (buffer.length !== 64) {
      throw new RpcError(`BytesN<64> requires exactly 64 bytes. Received: ${buffer.length}`);
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

  extractContractId(resultXdrBase64: string): string | null {
    try {
      const res = xdr.TransactionResult.fromXDR(Buffer.from(resultXdrBase64, 'base64'));
      const opResult = res.result().results()[0];
      const tr = opResult.tr();
      const arm = (tr as unknown as { arm: () => string }).arm();
      if (arm === 'invokeHostFunctionResult') {
        const result = (tr as unknown as { invokeHostFunctionResult: () => { success: () => Buffer } }).invokeHostFunctionResult();
        const contractIdBytes = result.success();
        if (contractIdBytes && contractIdBytes.length === 32) {
          return StrKey.encodeContract(contractIdBytes);
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}
