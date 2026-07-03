import { Address, Keypair, Operation, rpc, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { KairosClient } from '../client';
import { ROOT_AUTHORITY } from '../constants';
import { Caveat, Delegation, TransactionResult } from '../types';
import { computeDelegationHash, scValToBigInt } from '../utils';
import { ExecutionFailedError, PolicyViolationError, RpcError, TransactionSimulationError } from '../errors';

/** Safety margin (in ledgers) added to the current ledger when picking how long a
 * sponsored disable/enable authorization entry remains valid before it must be resubmitted. */
const AUTH_ENTRY_VALID_LEDGER_MARGIN = 100;

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
    const nonce = params.nonce !== undefined ? params.nonce : await this.getNonce(params.delegator);

    const unsignedDelegation: Omit<Delegation, 'signature'> = {
      delegate: params.delegate,
      delegator: params.delegator,
      authority,
      caveats,
      salt,
      nonce,
    };

    const hashStr = computeDelegationHash(
      unsignedDelegation,
      this.client.contracts.delegationManager,
      this.client.networkPassphrase
    );
    const hashBuffer = Buffer.from(hashStr, 'hex');

    let signatureBuffer: Buffer;
    if (typeof params.signer === 'function') {
      signatureBuffer = await params.signer(hashBuffer);
    } else {
      signatureBuffer = params.signer.sign(hashBuffer);
    }

    if (signatureBuffer.length !== 64) {
      throw new ExecutionFailedError(`Signature must be exactly 64 bytes. Received: ${signatureBuffer.length}`);
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
    const sourceAccount = await this.client.getAccount('GBKKNVTF24OKM2V7YRRQHLQIH6PTWDYRFMZPD6AUKB4RXAPSCRKB3XMO');
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

    const simRes = await this.client.simulateTx(tx);
    if (rpc.Api.isSimulationSuccess(simRes) && simRes.result) {
      return scValToBigInt(simRes.result.retval);
    }
    return 0n;
  }

  /**
   * Gets the hash of a delegation.
   */
  getHash(delegation: Delegation): string {
    return computeDelegationHash(
      delegation,
      this.client.contracts.delegationManager,
      this.client.networkPassphrase
    );
  }

  /**
   * Checks if a delegation hash is disabled on-chain.
   */
  async get(hash: string): Promise<{ disabled: boolean }> {
    const sourceAccount = await this.client.getAccount('GBKKNVTF24OKM2V7YRRQHLQIH6PTWDYRFMZPD6AUKB4RXAPSCRKB3XMO');
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

    const simRes = await this.client.simulateTx(tx);
    if (rpc.Api.isSimulationSuccess(simRes) && simRes.result) {
      return { disabled: simRes.result.retval.b() };
    }
    return { disabled: false };
  }

  /**
   * Disables a delegation on-chain.
   */
  async disable(delegation: Delegation, delegatorSigner: Keypair): Promise<TransactionResult> {
    const sourceAccount = await this.client.getAccount(delegatorSigner.publicKey());
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
  async revoke(delegation: Delegation, delegatorSigner: Keypair): Promise<TransactionResult> {
    return this.disable(delegation, delegatorSigner);
  }

  /**
   * Re-enables a delegation on-chain.
   */
  async enable(delegation: Delegation, delegatorSigner: Keypair): Promise<TransactionResult> {
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
   * Prepares a sponsored disable/enable: `funderAddress` pays fees as the transaction's
   * source account, but `disable_delegation`/`enable_delegation` still calls
   * `delegation.delegator.require_auth()` — when the delegator is a smart-wallet contract
   * (not an EOA the server holds a key for), that requires a separately-signed authorization
   * entry from the wallet's owner. Returns the unsigned entry (base64 XDR) for the owner's
   * wallet to sign — e.g. via Freighter's `signAuthEntry` — plus everything needed to submit
   * the exact same operation in `submitSponsoredDisable`/`submitSponsoredEnable`.
   */
  private async prepareSponsoredOp(
    functionName: 'disable_delegation' | 'enable_delegation' | 'register_delegation',
    delegation: Delegation,
    funderAddress: string
  ): Promise<{ unsignedEntryXdr: string; validUntilLedgerSeq: number }> {
    const delegationScVal = this.client.delegationToScVal(delegation);
    const op = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: functionName,
      args: [Address.fromString(delegation.delegator).toScVal(), delegationScVal],
    });

    const sourceAccount = await this.client.waitForAccount(funderAddress);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const simRes = await this.client.simulateTx(tx);
    if (!rpc.Api.isSimulationSuccess(simRes)) {
      throw new TransactionSimulationError('Simulation did not succeed', simRes);
    }
    const entry = simRes.result?.auth?.[0];
    if (!entry) {
      throw new TransactionSimulationError(
        'Simulation did not return an authorization entry for the delegator address',
        simRes
      );
    }

    const validUntilLedgerSeq = simRes.latestLedger + AUTH_ENTRY_VALID_LEDGER_MARGIN;
    entry.credentials().address().signatureExpirationLedger(validUntilLedgerSeq);

    return { unsignedEntryXdr: entry.toXDR('base64'), validUntilLedgerSeq };
  }

  private async submitSponsoredOp(
    functionName: 'disable_delegation' | 'enable_delegation' | 'register_delegation',
    delegation: Delegation,
    funder: Keypair,
    signedEntryXdr: string
  ): Promise<TransactionResult> {
    const delegationScVal = this.client.delegationToScVal(delegation);
    const signedEntry = xdr.SorobanAuthorizationEntry.fromXDR(signedEntryXdr, 'base64');
    const op = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: functionName,
      args: [Address.fromString(delegation.delegator).toScVal(), delegationScVal],
      auth: [signedEntry],
    });

    const sourceAccount = await this.client.waitForAccount(funder.publicKey());
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    return this.client.submitTransaction(tx, funder);
  }

  /**
   * Sponsored `register_delegation` — records this as the wallet's single active delegation
   * (rejects if one is already active). Must be called once after a delegation is signed,
   * before it can be looked up via `getWalletDelegation`.
   */
  async prepareSponsoredRegister(delegation: Delegation, funderAddress: string) {
    return this.prepareSponsoredOp('register_delegation', delegation, funderAddress);
  }

  async submitSponsoredRegister(delegation: Delegation, funder: Keypair, signedEntryXdr: string) {
    return this.submitSponsoredOp('register_delegation', delegation, funder, signedEntryXdr);
  }

  async prepareSponsoredDisable(delegation: Delegation, funderAddress: string) {
    return this.prepareSponsoredOp('disable_delegation', delegation, funderAddress);
  }

  async submitSponsoredDisable(delegation: Delegation, funder: Keypair, signedEntryXdr: string) {
    return this.submitSponsoredOp('disable_delegation', delegation, funder, signedEntryXdr);
  }

  async prepareSponsoredEnable(delegation: Delegation, funderAddress: string) {
    return this.prepareSponsoredOp('enable_delegation', delegation, funderAddress);
  }

  async submitSponsoredEnable(delegation: Delegation, funder: Keypair, signedEntryXdr: string) {
    return this.submitSponsoredOp('enable_delegation', delegation, funder, signedEntryXdr);
  }

  /**
   * Sponsored `revoke_by_wallet` — revokes the wallet's single active delegation without
   * needing to reconstruct the full `Delegation` struct (the manager resolves it via the
   * `WalletDelegation` map). Same sponsored-auth-entry pattern as disable/enable.
   */
  async prepareSponsoredRevokeByWallet(delegator: string, funderAddress: string) {
    const op = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: 'revoke_by_wallet',
      args: [Address.fromString(delegator).toScVal()],
    });
    const sourceAccount = await this.client.waitForAccount(funderAddress);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const simRes = await this.client.simulateTx(tx);
    if (!rpc.Api.isSimulationSuccess(simRes)) {
      throw new TransactionSimulationError('Simulation did not succeed', simRes);
    }
    const entry = simRes.result?.auth?.[0];
    if (!entry) {
      throw new TransactionSimulationError(
        'Simulation did not return an authorization entry for the delegator address',
        simRes
      );
    }
    const validUntilLedgerSeq = simRes.latestLedger + AUTH_ENTRY_VALID_LEDGER_MARGIN;
    entry.credentials().address().signatureExpirationLedger(validUntilLedgerSeq);
    return { unsignedEntryXdr: entry.toXDR('base64'), validUntilLedgerSeq };
  }

  async submitSponsoredRevokeByWallet(delegator: string, funder: Keypair, signedEntryXdr: string) {
    const signedEntry = xdr.SorobanAuthorizationEntry.fromXDR(signedEntryXdr, 'base64');
    const op = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: 'revoke_by_wallet',
      args: [Address.fromString(delegator).toScVal()],
      auth: [signedEntry],
    });
    const sourceAccount = await this.client.waitForAccount(funder.publicKey());
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();
    return this.client.submitTransaction(tx, funder);
  }

  /**
   * Sponsored `set_policy` — updates a policy's terms in place for (delegator, policyId)
   * without touching the Delegation struct, its hash, or its signature. This is the "edit
   * limits/assets/expiry without minting a new delegation" path.
   */
  async prepareSponsoredSetPolicy(delegator: string, policyId: bigint, terms: Uint8Array, funderAddress: string) {
    const op = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: 'set_policy',
      args: [
        Address.fromString(delegator).toScVal(),
        xdr.ScVal.scvU64(new xdr.Uint64(policyId)),
        xdr.ScVal.scvBytes(Buffer.from(terms)),
      ],
    });
    const sourceAccount = await this.client.waitForAccount(funderAddress);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const simRes = await this.client.simulateTx(tx);
    if (!rpc.Api.isSimulationSuccess(simRes)) {
      throw new TransactionSimulationError('Simulation did not succeed', simRes);
    }
    const entry = simRes.result?.auth?.[0];
    if (!entry) {
      throw new TransactionSimulationError(
        'Simulation did not return an authorization entry for the delegator address',
        simRes
      );
    }
    const validUntilLedgerSeq = simRes.latestLedger + AUTH_ENTRY_VALID_LEDGER_MARGIN;
    entry.credentials().address().signatureExpirationLedger(validUntilLedgerSeq);
    return { unsignedEntryXdr: entry.toXDR('base64'), validUntilLedgerSeq };
  }

  async submitSponsoredSetPolicy(
    delegator: string,
    policyId: bigint,
    terms: Uint8Array,
    funder: Keypair,
    signedEntryXdr: string
  ) {
    const signedEntry = xdr.SorobanAuthorizationEntry.fromXDR(signedEntryXdr, 'base64');
    const op = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: 'set_policy',
      args: [
        Address.fromString(delegator).toScVal(),
        xdr.ScVal.scvU64(new xdr.Uint64(policyId)),
        xdr.ScVal.scvBytes(Buffer.from(terms)),
      ],
      auth: [signedEntry],
    });
    const sourceAccount = await this.client.waitForAccount(funder.publicKey());
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();
    return this.client.submitTransaction(tx, funder);
  }

  /**
   * Sponsored `set_policies` — seeds/updates several (policyId, terms) pairs in one signed
   * call. Used right after registering a delegation whose caveats reference these ids via
   * the `0xFE` marker (see `PolicyModule.createIndexed`), and for the wizard's bulk policy
   * update path.
   */
  async prepareSponsoredSetPolicies(
    delegator: string,
    policyIds: bigint[],
    termsList: Uint8Array[],
    funderAddress: string
  ) {
    const op = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: 'set_policies',
      args: [
        Address.fromString(delegator).toScVal(),
        xdr.ScVal.scvVec(policyIds.map((id) => xdr.ScVal.scvU64(new xdr.Uint64(id)))),
        xdr.ScVal.scvVec(termsList.map((t) => xdr.ScVal.scvBytes(Buffer.from(t)))),
      ],
    });
    const sourceAccount = await this.client.waitForAccount(funderAddress);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const simRes = await this.client.simulateTx(tx);
    if (!rpc.Api.isSimulationSuccess(simRes)) {
      throw new TransactionSimulationError('Simulation did not succeed', simRes);
    }
    const entry = simRes.result?.auth?.[0];
    if (!entry) {
      throw new TransactionSimulationError(
        'Simulation did not return an authorization entry for the delegator address',
        simRes
      );
    }
    const validUntilLedgerSeq = simRes.latestLedger + AUTH_ENTRY_VALID_LEDGER_MARGIN;
    entry.credentials().address().signatureExpirationLedger(validUntilLedgerSeq);
    return { unsignedEntryXdr: entry.toXDR('base64'), validUntilLedgerSeq };
  }

  async submitSponsoredSetPolicies(
    delegator: string,
    policyIds: bigint[],
    termsList: Uint8Array[],
    funder: Keypair,
    signedEntryXdr: string
  ) {
    const signedEntry = xdr.SorobanAuthorizationEntry.fromXDR(signedEntryXdr, 'base64');
    const op = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: 'set_policies',
      args: [
        Address.fromString(delegator).toScVal(),
        xdr.ScVal.scvVec(policyIds.map((id) => xdr.ScVal.scvU64(new xdr.Uint64(id)))),
        xdr.ScVal.scvVec(termsList.map((t) => xdr.ScVal.scvBytes(Buffer.from(t)))),
      ],
      auth: [signedEntry],
    });
    const sourceAccount = await this.client.waitForAccount(funder.publicKey());
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();
    return this.client.submitTransaction(tx, funder);
  }

  /** True if the wallet already has an active (non-disabled) delegation registered. */
  async getWalletDelegation(delegator: string): Promise<string | null> {
    const sourceAccount = await this.client.getAccount('GBKKNVTF24OKM2V7YRRQHLQIH6PTWDYRFMZPD6AUKB4RXAPSCRKB3XMO');
    const op = Operation.invokeContractFunction({
      contract: this.client.contracts.delegationManager,
      function: 'get_wallet_delegation',
      args: [Address.fromString(delegator).toScVal()],
    });
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const simRes = await this.client.simulateTx(tx);
    if (rpc.Api.isSimulationSuccess(simRes) && simRes.result) {
      const opt = simRes.result.retval;
      if (opt.switch().name === 'scvVoid') return null;
      return Buffer.from(opt.bytes()).toString('hex');
    }
    return null;
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

  async list(delegator?: string): Promise<string[]> {
    const eventTypes = ['del_dis', 'del_en', 'redeemed'];
    const topicFilters = eventTypes.map(t => ({
      topics: [t],
    }));

    const events = await this.client.events.query({
      topicFilters
    });

    const hashes = events
      .map(e => e.data.hash)
      .filter((h): h is string => typeof h === 'string' && h.length > 0);

    const uniqueHashes = Array.from(new Set(hashes));

    if (delegator) {
      return uniqueHashes.filter(h => {
        const matchingEvents = events.filter(e => e.data.hash === h);
        return matchingEvents.some(e =>
          typeof e.data.delegator === 'string' && e.data.delegator === delegator
        );
      });
    }

    return uniqueHashes;
  }
}
