import { Address, Keypair, Operation, rpc, TransactionBuilder } from '@stellar/stellar-sdk';
import { KairosClient } from '../client';
import { ExecutionFailedError, KairosError, RpcError } from '../errors';

export class RegistryModule {
  constructor(private client: KairosClient) {}

  private get contractId(): string {
    const id = this.client.contracts.registry;
    if (!id) {
      throw new RpcError('Registry contract ID is not configured on this KairosClient.');
    }
    return id;
  }

  /**
   * Read-only lookup of the smart wallet registered on-chain for `owner`. Returns `null` ONLY
   * when the lookup succeeded and the contract reported no registration (`scvVoid` retval) —
   * that's the sole case that means "wallet not registered". Any RPC failure, network error,
   * simulation failure, or timeout throws (RpcError) instead of returning `null`: the Registry
   * is the canonical source of truth, so a caller that couldn't reach it must never treat that
   * as "not registered" (see apps/web/app/api/connect/check/route.ts, which relies on this
   * distinction to avoid offering "Create Smart Wallet" to an owner whose existing wallet we
   * simply failed to look up).
   */
  async getSmartWallet(owner: string): Promise<string | null> {
    let simRes: rpc.Api.SimulateTransactionResponse;
    try {
      const sourceAccount = await this.client.getAccount('GBKKNVTF24OKM2V7YRRQHLQIH6PTWDYRFMZPD6AUKB4RXAPSCRKB3XMO');

      const lookupOp = Operation.invokeContractFunction({
        contract: this.contractId,
        function: 'get_smart_wallet',
        args: [Address.fromString(owner).toScVal()],
      });

      const tx = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.client.networkPassphrase,
      })
        .addOperation(lookupOp)
        .setTimeout(30)
        .build();

      // `simulateTx` always either returns a success response or throws (see client.ts) — the
      // isSimulationSuccess/`.result` checks that used to live here were dead code that masked
      // real failures as `null`.
      simRes = await this.client.simulateTx(tx);
    } catch (err) {
      if (err instanceof KairosError) throw err;
      throw new RpcError(
        `Registry lookup failed for ${owner}: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    // Defensive: `simulateTx` is documented to always succeed-or-throw, but narrow explicitly
    // instead of trusting that contract blindly — a non-success response here is exactly the
    // kind of ambiguous case that must throw, not silently read as `null`.
    if (!rpc.Api.isSimulationSuccess(simRes)) {
      throw new RpcError(`Registry lookup for ${owner} did not simulate successfully.`, simRes);
    }
    // `isSimulationSuccess` only checks for a `transactionData` field — it does NOT guarantee
    // `result` is present. The underlying SDK omits `result` entirely when the RPC response's
    // `results` array is empty (a malformed/incomplete response from a degraded RPC node or
    // proxy), which is distinct from a real invocation result. Treating a missing `result` the
    // same as a present `result` with `scvVoid` would silently read "we can't tell" as "no
    // wallet" — the exact fail-open bug this lookup exists to avoid. Only a `result` that is
    // actually present is a confirmed answer from the contract.
    if (!simRes.result) {
      throw new RpcError(`Registry lookup for ${owner} returned a malformed simulation response (missing result).`, simRes);
    }
    const retval = simRes.result.retval;
    if (!retval || retval.switch().name === 'scvVoid') {
      return null;
    }
    // A present, non-void retval is expected to be an Address ScVal (the contract's return
    // type). `Address.fromScVal` throws a raw TypeError for any other ScVal shape (e.g. a
    // malformed/incompatible RPC response) — normalize that into the same RpcError used for
    // every other "couldn't get a confirmed answer from the Registry" case above, instead of
    // letting an SDK-internal TypeError leak out of this method.
    try {
      return Address.fromScVal(retval).toString();
    } catch (err) {
      throw new RpcError(
        `Registry lookup for ${owner} returned a malformed retval (expected an Address ScVal): ${err instanceof Error ? err.message : String(err)}`,
        retval
      );
    }
  }

  /**
   * Funder-attested registration: the funder is both the transaction source account and
   * the `admin` argument, so no separate owner authorization entry is needed. The binding
   * is still owner-consented without an owner signature because the Registry contract
   * cross-calls `smart_wallet.owner()` and rejects any mismatch (M1 fix) — a lone admin
   * key cannot point a victim owner's entry at a wallet that owner doesn't control.
   * `smartWalletAddress` must already be deployed on-chain for that cross-call to resolve.
   */
  async register(funder: Keypair, ownerAddress: string, smartWalletAddress: string): Promise<void> {
    const sourceAccount = await this.client.waitForAccount(funder.publicKey());

    const registerOp = Operation.invokeContractFunction({
      contract: this.contractId,
      function: 'register',
      args: [
        Address.fromString(funder.publicKey()).toScVal(),
        Address.fromString(ownerAddress).toScVal(),
        Address.fromString(smartWalletAddress).toScVal(),
      ],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(registerOp)
      .setTimeout(30)
      .build();

    const result = await this.client.submitTransaction(tx, funder);
    if (result.status !== 'SUCCESS') {
      const errMsg = typeof result.error === 'object' ? JSON.stringify(result.error) : (result.error || `status=${result.status} hash=${result.hash}`);
      throw new ExecutionFailedError(`Failed to register smart wallet in registry: ${errMsg}`);
    }
  }
}
