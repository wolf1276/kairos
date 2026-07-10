import * as crypto from 'crypto';
import { Address, Keypair, Operation, rpc, TransactionBuilder, xdr, StrKey, hash } from '@stellar/stellar-sdk';
import { KairosClient } from '../client';
import { Wallet, TransactionResult } from '../types';
import { scValToBigInt } from '../utils';
import { ExecutionFailedError, RpcError, TransactionSimulationError } from '../errors';

/** Safety margin (in ledgers) added to the current ledger when picking how long a
 * sponsored-deploy authorization entry remains valid before it must be resubmitted. */
const AUTH_ENTRY_VALID_LEDGER_MARGIN = 100;

interface DeployArtifacts {
  func: xdr.HostFunction;
  smartWalletAddress: string;
}

export class WalletModule {
  constructor(private client: KairosClient) {}

  /**
   * Builds the deterministic CreateContractV2 host function + resulting contract address
   * for a CustomAccount deploy, given a fixed salt. The wallet's `__constructor` (owner,
   * delegation_manager) runs atomically as part of this same host operation — see
   * docs/security/MAINNET_AUDIT.md, P0-1: this closes the on-chain window a separate,
   * later `init` transaction used to leave open for a front-runner to self-claim the
   * address. Shared by the plain self-deploy path (`create`) and the sponsored-deploy
   * path (`prepareSponsoredDeploy`/`submitSponsoredDeploy`) so both compute byte-for-byte
   * the same preimage/address for a given salt.
   */
  private buildDeployArtifacts(ownerAddress: string, wasmHash: string, salt: Buffer): DeployArtifacts {
    const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new xdr.ContractIdPreimageFromAddress({
        address: Address.fromString(ownerAddress).toScAddress(),
        salt,
      })
    );
    const executable = xdr.ContractExecutable.contractExecutableWasm(
      Buffer.from(wasmHash, 'hex')
    );
    const constructorArgs = [
      Address.fromString(ownerAddress).toScVal(),
      Address.fromString(this.client.contracts.delegationManager).toScVal(),
    ];
    const createContractArgs = new xdr.CreateContractArgsV2({
      contractIdPreimage: preimage,
      executable,
      constructorArgs,
    });
    const func = xdr.HostFunction.hostFunctionTypeCreateContractV2(createContractArgs);

    const networkId = xdr.Hash.fromXDR(hash(Buffer.from(this.client.networkPassphrase)));
    const preimageContractId = new xdr.HashIdPreimageContractId({
      networkId,
      contractIdPreimage: preimage,
    });
    const hashIdPreimage = xdr.HashIdPreimage.envelopeTypeContractId(preimageContractId);
    const contractIdBytes = hash(hashIdPreimage.toXDR());
    const smartWalletAddress = StrKey.encodeContract(contractIdBytes);

    return { func, smartWalletAddress };
  }

  /**
   * Deploys a new CustomAccount (smart wallet) instance, atomically initialized in the
   * same operation (see `buildDeployArtifacts` — CreateContractV2 + constructor, no
   * separate init transaction/window). The `payer` must control `ownerAddress`'s key (it
   * signs the deploy transaction itself), since Soroban only auto-authorizes a
   * `CreateContract` call — and the constructor's `owner.require_auth()` inside it — when
   * the embedded owner address equals the transaction's source account. For deploying a
   * wallet on behalf of an address the caller does NOT hold a key for (e.g. sponsoring a
   * connected Freighter wallet's onboarding), use `prepareSponsoredDeploy`/
   * `submitSponsoredDeploy` instead, which authorize the owner address via a
   * separately-signed authorization entry.
   * @param payer The Keypair that pays fees and signs the deploy transaction.
   * @param wasmHash The hex string of the uploaded CustomAccount WASM hash.
   * @param ownerAddress The address that will own the deployed wallet (contract ID salt
   *   and `Owner` storage are bound to this address). Defaults to `payer.publicKey()`.
   * @returns The deployed Wallet details.
   */
  async create(payer: Keypair, wasmHash: string, ownerAddress: string = payer.publicKey()): Promise<Wallet> {
    if (!/^[a-f0-9]{64}$/i.test(wasmHash)) {
      throw new RpcError(`CustomAccount WASM hash must be a 64-character hex string. Received: ${wasmHash}`);
    }

    // `waitForAccount` (rather than `getAccount`) ensures the payer is actually funded
    // on-chain before we build a transaction against it.
    const sourceAccount = await this.client.waitForAccount(payer.publicKey());

    const salt = crypto.randomBytes(32);
    const { func, smartWalletAddress } = this.buildDeployArtifacts(ownerAddress, wasmHash, salt);
    const deployOp = Operation.invokeHostFunction({
      func,
      auth: [],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(deployOp)
      .setTimeout(30)
      .build();

    const result = await this.client.submitTransaction(tx, payer);
    if (result.status !== 'SUCCESS') {
      const errMsg = typeof result.error === 'object' ? JSON.stringify(result.error) : (result.error || `status=${result.status} hash=${result.hash}`);
      throw new ExecutionFailedError(`Failed to deploy and initialize CustomAccount contract: ${errMsg}`);
    }

    return {
      address: smartWalletAddress,
      owner: ownerAddress,
      delegationManager: this.client.contracts.delegationManager,
    };
  }

  /**
   * Prepares a sponsored CustomAccount deployment: `funderAddress` will pay all fees as
   * the transaction's source account, but Soroban still requires the embedded owner
   * address (a connected wallet whose key the server doesn't hold) to separately
   * authorize both contract creation and the constructor call that atomically
   * initializes it (`owner.require_auth()` inside `__constructor`). Returns the unsigned
   * authorization entry (as base64 XDR) for the owner's wallet to sign — e.g. via
   * Freighter's `signAuthEntry` — plus the deterministic salt/contract address needed to
   * reconstruct and submit the exact same deployment in `submitSponsoredDeploy`.
   */
  async prepareSponsoredDeploy(
    funderAddress: string,
    ownerAddress: string,
    wasmHash: string
  ): Promise<{ unsignedEntryXdr: string; smartWalletAddress: string; saltHex: string; validUntilLedgerSeq: number }> {
    if (!/^[a-f0-9]{64}$/i.test(wasmHash)) {
      throw new RpcError(`CustomAccount WASM hash must be a 64-character hex string. Received: ${wasmHash}`);
    }

    const salt = crypto.randomBytes(32);
    const { func, smartWalletAddress } = this.buildDeployArtifacts(ownerAddress, wasmHash, salt);

    const sourceAccount = await this.client.waitForAccount(funderAddress);
    const deployOp = Operation.invokeHostFunction({ func, auth: [] });
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(deployOp)
      .setTimeout(30)
      .build();

    // Simulating with empty auth surfaces the exact unsigned SorobanAuthorizationEntry
    // Soroban requires for the owner address embedded in the CreateContractV2 preimage —
    // one entry covering both authorizing contract creation itself and the nested
    // `owner.require_auth()` inside `__constructor`, since Soroban auth entries are keyed
    // per address across the whole invocation tree, not per call.
    // `simulateTx` always either returns a success response or throws, but its type
    // signature is the general union, so narrow it here to access `.result`.
    const simRes = await this.client.simulateTx(tx);
    if (!rpc.Api.isSimulationSuccess(simRes)) {
      throw new TransactionSimulationError('Simulation did not succeed', simRes);
    }
    const entry = simRes.result?.auth?.[0];
    if (!entry) {
      throw new TransactionSimulationError(
        'Simulation did not return an authorization entry for the owner address',
        simRes
      );
    }

    const validUntilLedgerSeq = simRes.latestLedger + AUTH_ENTRY_VALID_LEDGER_MARGIN;
    entry.credentials().address().signatureExpirationLedger(validUntilLedgerSeq);

    return {
      unsignedEntryXdr: entry.toXDR('base64'),
      smartWalletAddress,
      saltHex: salt.toString('hex'),
      validUntilLedgerSeq,
    };
  }

  /**
   * Submits a sponsored CustomAccount deployment using the owner's authorization entry
   * signed by `prepareSponsoredDeploy`'s output. `funder` remains the transaction's
   * source account (and pays all fees) throughout — the owner address never needs to
   * sign or fund anything itself.
   */
  async submitSponsoredDeploy(
    funder: Keypair,
    ownerAddress: string,
    wasmHash: string,
    saltHex: string,
    signedEntryXdr: string
  ): Promise<Wallet> {
    const salt = Buffer.from(saltHex, 'hex');
    const { func, smartWalletAddress } = this.buildDeployArtifacts(ownerAddress, wasmHash, salt);

    const signedEntry = xdr.SorobanAuthorizationEntry.fromXDR(signedEntryXdr, 'base64');
    const deployOp = Operation.invokeHostFunction({ func, auth: [signedEntry] });

    const sourceAccount = await this.client.waitForAccount(funder.publicKey());
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(deployOp)
      .setTimeout(30)
      .build();

    const result = await this.client.submitTransaction(tx, funder);
    if (result.status !== 'SUCCESS') {
      const errMsg = typeof result.error === 'object' ? JSON.stringify(result.error) : (result.error || `status=${result.status} hash=${result.hash}`);
      throw new ExecutionFailedError(`Failed to deploy and initialize CustomAccount contract: ${errMsg}`);
    }

    return {
      address: smartWalletAddress,
      owner: ownerAddress,
      delegationManager: this.client.contracts.delegationManager,
    };
  }

  /**
   * Loads an existing wallet's details by reading its owner from storage.
   */
  async load(address: string): Promise<Wallet> {
    const owner = await this.owner(address);
    return {
      address,
      owner,
      delegationManager: this.client.contracts.delegationManager,
    };
  }

  /**
   * Gets the owner address of the Smart Custom Account.
   */
  async owner(address: string): Promise<string> {
    const result = await this.client.readInstanceStorage(address, 'Owner');
    if (!result) {
      throw new RpcError(`Could not retrieve owner for wallet: ${address}`);
    }
    return Address.fromScVal(result).toString();
  }

  /**
   * Returns the balance of a token (e.g. Stellar Asset Contract) for the wallet.
   */
  async balance(address: string, tokenAddress: string): Promise<bigint> {
    const sourceAccount = await this.client.getAccount('GBKKNVTF24OKM2V7YRRQHLQIH6PTWDYRFMZPD6AUKB4RXAPSCRKB3XMO');
    
    const balanceOp = Operation.invokeContractFunction({
      contract: tokenAddress,
      function: 'balance',
      args: [Address.fromString(address).toScVal()],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(balanceOp)
      .setTimeout(30)
      .build();

    const simRes = await this.client.simulateTx(tx);
    // A missing `result` means the RPC response was malformed, not that the balance is 0 —
    // silently returning 0n would look like a genuine (empty) balance answer. Throw instead.
    if (!rpc.Api.isSimulationSuccess(simRes) || !simRes.result) {
      throw new RpcError(`Failed to fetch balance for ${address}: malformed simulation response (missing result).`, simRes);
    }
    return scValToBigInt(simRes.result.retval);
  }

  /**
   * Directly executes a target contract function from the wallet (owner invocation).
   */
  async execute(
    walletAddress: string,
    owner: Keypair,
    target: string,
    functionName: string,
    args: xdr.ScVal[]
  ): Promise<TransactionResult> {
    const sourceAccount = await this.client.getAccount(owner.publicKey());
    
    const execOp = Operation.invokeContractFunction({
      contract: walletAddress,
      function: 'execute',
      args: [
        Address.fromString(target).toScVal(),
        xdr.ScVal.scvSymbol(functionName),
        xdr.ScVal.scvVec(args),
      ],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(execOp)
      .setTimeout(30)
      .build();

    return this.client.submitTransaction(tx, owner);
  }
}
