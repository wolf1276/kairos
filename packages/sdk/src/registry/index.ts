import { Address, Keypair, Operation, rpc, TransactionBuilder } from '@stellar/stellar-sdk';
import { KairosClient } from '../client';
import { ExecutionFailedError, RpcError, TransactionSimulationError } from '../errors';

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
   * Read-only lookup of the smart wallet registered on-chain for `owner`, or `null` if
   * none has been registered yet.
   */
  async getSmartWallet(owner: string): Promise<string | null> {
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

    const simRes = await this.client.simulateTx(tx);
    if (!rpc.Api.isSimulationSuccess(simRes) || !simRes.result) {
      return null;
    }
    const retval = simRes.result.retval;
    if (retval.switch().name === 'scvVoid') {
      return null;
    }
    return Address.fromScVal(retval).toString();
  }

  /**
   * Funder-attested registration: the funder is both the transaction source account and
   * the `admin` argument, so (unlike the wallet deploy) no separate owner authorization
   * entry is needed — the funder already sponsors and observes the deploy transaction.
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
