import { Address, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { KairosClient } from '../client';
import { ROOT_AUTHORITY } from '../constants';
import { Caveat, Delegation } from '../types';
import { computeDelegationHash } from '../utils';

export class DelegationModule {
  constructor(private client: KairosClient) {}

  /**
   * Creates a signed delegation structure.
   * @param params Configuration parameters for the delegation.
   */
  async create(params: {
    delegate: string;
    delegator: string;
    authority?: string;
    caveats?: Caveat[];
    salt?: bigint;
    nonce?: bigint;
    signer: Keypair | ((hash: Buffer) => Promise<Buffer> | Buffer);
  }): Promise<Delegation> {
    const authority = params.authority || ROOT_AUTHORITY;
    const caveats = params.caveats || [];
    const salt = params.salt || BigInt(Math.floor(Math.random() * 1000000));
    
    // Fetch nonce from contract if not provided
    const nonce = params.nonce !== undefined ? params.nonce : await this.client.delegation.getNonce(params.delegator);

    const unsignedDelegation: Omit<Delegation, 'signature'> = {
      delegate: params.delegate,
      delegator: params.delegator,
      authority,
      caveats,
      salt,
      nonce,
    };

    const hashStr = computeDelegationHash(unsignedDelegation);
    const hashBuffer = Buffer.from(hashStr, 'hex');

    let signatureBuffer: Buffer;
    if (typeof params.signer === 'function') {
      signatureBuffer = await params.signer(hashBuffer);
    } else {
      signatureBuffer = params.signer.sign(hashBuffer);
    }

    if (signatureBuffer.length !== 64) {
      throw new Error(`Signature must be exactly 64 bytes. Received: ${signatureBuffer.length}`);
    }

    return {
      ...unsignedDelegation,
      signature: signatureBuffer.toString('hex'),
    };
  }

  /**
   * Fetches the current nonce for a delegator from the DelegationManager.
   */
  async getNonce(delegator: string): Promise<bigint> {
    const sourceAccount = await this.client.getAccount(this.client.contracts.delegationManager);
    const nonceOp = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: 'get_nonce',
      args: [Address.fromString(delegator).toScVal()],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(nonceOp)
      .setTimeout(30)
      .build();

    const simRes = (await this.client.simulateTx(tx)) as any;
    if (simRes.results?.[0]?.xdr) {
      const val = this.client.parseScVal(simRes.results[0].xdr);
      return val.u64().toBigInt();
    }
    return 0n;
  }

  /**
   * Gets the hash of a delegation.
   */
  getHash(delegation: Delegation): string {
    return computeDelegationHash(delegation);
  }

  /**
   * Checks if a delegation hash is disabled on-chain.
   */
  async get(hash: string): Promise<{ disabled: boolean }> {
    const sourceAccount = await this.client.getAccount(this.client.contracts.delegationManager);
    const disabledOp = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: 'is_delegation_disabled',
      args: [
        this.client.hexToBytesN32ScVal(hash),
      ],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(disabledOp)
      .setTimeout(30)
      .build();

    const simRes = (await this.client.simulateTx(tx)) as any;
    if (simRes.results?.[0]?.xdr) {
      const val = this.client.parseScVal(simRes.results[0].xdr);
      return { disabled: val.b() };
    }
    return { disabled: false };
  }

  /**
   * Disables a delegation on-chain.
   */
  async disable(delegation: Delegation, delegatorSigner: Keypair): Promise<any> {
    const sourceAccount = await this.client.getAccount(delegatorSigner.publicKey());
    
    // We convert delegation structure to ScVal structure
    const delegationScVal = this.client.delegationToScVal(delegation);

    const disableOp = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: 'disable_delegation',
      args: [
        Address.fromString(delegation.delegator).toScVal(),
        delegationScVal,
      ],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(disableOp)
      .setTimeout(30)
      .build();

    return this.client.submitTransaction(tx, delegatorSigner);
  }

  /**
   * Alias for disable.
   */
  async revoke(delegation: Delegation, delegatorSigner: Keypair): Promise<any> {
    return this.disable(delegation, delegatorSigner);
  }

  /**
   * Re-enables a delegation on-chain.
   */
  async enable(delegation: Delegation, delegatorSigner: Keypair): Promise<any> {
    const sourceAccount = await this.client.getAccount(delegatorSigner.publicKey());
    const delegationScVal = this.client.delegationToScVal(delegation);

    const enableOp = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: 'enable_delegation',
      args: [
        Address.fromString(delegation.delegator).toScVal(),
        delegationScVal,
      ],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(enableOp)
      .setTimeout(30)
      .build();

    return this.client.submitTransaction(tx, delegatorSigner);
  }

  /**
   * Renews a delegation by incrementing the nonce or renewing parameters.
   */
  async renew(
    oldDelegation: Delegation,
    newParams: {
      caveats?: Caveat[];
      salt?: bigint;
      signer: Keypair | ((hash: Buffer) => Promise<Buffer> | Buffer);
    }
  ): Promise<Delegation> {
    // Renew delegation with a fresh nonce or custom properties
    const freshNonce = await this.getNonce(oldDelegation.delegator);
    return this.create({
      delegate: oldDelegation.delegate,
      delegator: oldDelegation.delegator,
      authority: oldDelegation.authority,
      caveats: newParams.caveats || oldDelegation.caveats,
      salt: newParams.salt || oldDelegation.salt,
      nonce: freshNonce,
      signer: newParams.signer,
    });
  }

  /**
   * Helper to list delegations (returns empty list / mock status since it's off-chain client,
   * but could query indexer if available).
   */
  async list(): Promise<Delegation[]> {
    return [];
  }
}
