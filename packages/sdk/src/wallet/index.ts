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
   * Builds the deterministic CreateContract host function + resulting contract address
   * for a CustomAccount deploy, given a fixed salt. Shared by the plain self-deploy path
   * (`create`) and the sponsored-deploy path (`prepareSponsoredDeploy`/`submitSponsoredDeploy`)
   * so both compute byte-for-byte the same preimage/address for a given salt.
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
    const createContractArgs = new xdr.CreateContractArgs({
      contractIdPreimage: preimage,
      executable,
    });
    const func = xdr.HostFunction.hostFunctionTypeCreateContract(createContractArgs);

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
   * Deploys a new CustomAccount (smart wallet) instance and initializes it. The `payer`
   * must control `ownerAddress`'s key (it signs the deploy transaction itself), since
   * Soroban only auto-authorizes a `CreateContract` call when the embedded owner address
   * equals the transaction's source account. For deploying a wallet on behalf of an
   * address the caller does NOT hold a key for (e.g. sponsoring a connected Freighter
   * wallet's onboarding), use `prepareSponsoredDeploy`/`submitSponsoredDeploy` instead,
   * which authorize the owner address via a separately-signed authorization entry.
   * @param payer The Keypair that pays fees and signs the deploy/init transactions.
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
      throw new ExecutionFailedError(`Failed to deploy CustomAccount contract: ${errMsg}`);
    }

    let initialized = false;
    let lastError: string | undefined;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await this.initializeWallet(smartWalletAddress, payer, ownerAddress);
        initialized = true;
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'Unknown error';
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    if (!initialized) {
      throw new ExecutionFailedError(`Failed to initialize CustomAccount: ${lastError || 'Unknown error'}`);
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
   * authorize the `CreateContract` call. Returns the unsigned authorization entry (as
   * base64 XDR) for the owner's wallet to sign — e.g. via Freighter's `signAuthEntry` —
   * plus the deterministic salt/contract address needed to reconstruct and submit the
   * exact same deployment in `submitSponsoredDeploy`.
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
    // Soroban requires for the owner address embedded in the CreateContract preimage.
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
      throw new ExecutionFailedError(`Failed to deploy CustomAccount contract: ${errMsg}`);
    }

    let initialized = false;
    let lastError: string | undefined;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await this.initializeWallet(smartWalletAddress, funder, ownerAddress);
        initialized = true;
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'Unknown error';
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    if (!initialized) {
      throw new ExecutionFailedError(`Failed to initialize CustomAccount: ${lastError || 'Unknown error'}`);
    }

    return {
      address: smartWalletAddress,
      owner: ownerAddress,
      delegationManager: this.client.contracts.delegationManager,
    };
  }

  /**
   * Initializes the wallet with owner and delegation manager.
   */
  private async initializeWallet(contractId: string, payer: Keypair, ownerAddress: string): Promise<void> {
    const sourceAccount = await this.client.getAccount(payer.publicKey());

    const initOp = Operation.invokeContractFunction({
      contract: contractId,
      function: 'init',
      args: [
        Address.fromString(ownerAddress).toScVal(),
        Address.fromString(this.client.contracts.delegationManager).toScVal(),
      ],
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100000',
      networkPassphrase: this.client.networkPassphrase,
    })
      .addOperation(initOp)
      .setTimeout(30)
      .build();

    const result = await this.client.submitTransaction(tx, payer);
    if (result.status !== 'SUCCESS') {
      throw new ExecutionFailedError(`Failed to initialize CustomAccount: ${result.error}`);
    }
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
    if (rpc.Api.isSimulationSuccess(simRes) && simRes.result) {
      return scValToBigInt(simRes.result.retval);
    }
    return 0n;
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
