import {
  Horizon,
  Networks,
  Asset,
  Address,
  Operation,
  TransactionBuilder,
  BASE_FEE,
  StrKey,
  nativeToScVal,
  scValToBigInt,
  rpc,
  xdr,
  authorizeEntry,
} from "@stellar/stellar-sdk";
import {
  kitGetAddress,
  kitGetNetwork,
  kitSignTransaction,
  kitSignAuthEntry,
  kitSignMessage,
  kitDisconnect,
} from "@/app/lib/walletKit";

// ── Constants ──

const HORIZON_URLS: Record<string, string> = {
  [Networks.PUBLIC]: "https://horizon.stellar.org",
  [Networks.TESTNET]: "https://horizon-testnet.stellar.org",
  [Networks.FUTURENET]: "https://horizon-futurenet.stellar.org",
};

const SOROBAN_RPC_URLS: Record<string, string> = {
  [Networks.PUBLIC]: "https://mainnet.sorobanrpc.com",
  [Networks.TESTNET]: "https://soroban-testnet.stellar.org",
  [Networks.FUTURENET]: "https://rpc-futurenet.stellar.org",
};

/** Looks up the Horizon URL for a network passphrase — throws instead of silently defaulting to
 *  testnet if the passphrase isn't one we recognize. */
function horizonUrlFor(networkPassphrase: string): string {
  const url = HORIZON_URLS[networkPassphrase];
  if (!url) throw new Error(`No Horizon URL configured for network: ${networkPassphrase}`);
  return url;
}

/** Looks up the Soroban RPC URL for a network passphrase — throws instead of silently defaulting
 *  to testnet if the passphrase isn't one we recognize. */
function sorobanRpcUrlFor(networkPassphrase: string): string {
  const url = SOROBAN_RPC_URLS[networkPassphrase];
  if (!url) throw new Error(`No Soroban RPC URL configured for network: ${networkPassphrase}`);
  return url;
}

// ── Types ──

export interface WalletState {
  address: string;
  network: string;
  networkPassphrase: string;
  sorobanRpcUrl: string;
  balance: string;
  isTestnet: boolean;
  smartWalletAddress?: string;
}

export interface DelegationResult {
  hash: string;
  amount: string;
  destination: string;
}

// ── Browser guard (wallet extensions only run in the browser) ──

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

// ── Wallet-kit helpers ──
// Any wallet the Stellar Wallets Kit supports (Freighter, Albedo, xBull, HOT Wallet, Rabet,
// Lobstr, Hana, Klever) can drive these — the kit routes each call to whichever wallet the user
// picked in the connect modal.

/** Check whether the kit already has a previously-selected wallet in memory (persisted across
 *  reloads in its own localStorage) — lets the app silently restore a session without a popup. */
export async function tryCheckConnection(): Promise<boolean> {
  if (!isBrowser()) return false;
  try {
    await kitGetAddress();
    return true;
  } catch {
    return false;
  }
}

/** Sign a transaction XDR with the connected wallet's popup/extension. */
async function signWithWallet(
  xdr: string,
  networkPassphrase: string,
  address: string
): Promise<string> {
  return kitSignTransaction(xdr, { networkPassphrase, address });
}

/**
 * Sign a single Soroban authorization entry with the connected wallet — used for sponsored
 * contract calls where a server-side funder pays transaction fees but the connected
 * wallet must still separately authorize its own address's participation (e.g. the
 * `CreateContract` call when deploying a smart wallet on behalf of this address).
 *
 * Freighter's `signAuthEntry` signs the entry's `HashIdPreimage` (the payload that
 * gets hashed for the signature), not the full `SorobanAuthorizationEntry` XDR —
 * passing the whole entry causes Freighter to fail with "Invalid Authorization
 * Entry ... XDR could not be parsed". `authorizeEntry` (from stellar-sdk) drives
 * that exact preimage/signature handshake and splices the result back into a
 * fully-signed entry. Other kit wallets may not implement `signAuthEntry` at all —
 * this will surface as a natural error from those wallets rather than a supported flow.
 */
export async function signAuthEntryWithWallet(
  unsignedEntryXdr: string,
  validUntilLedgerSeq: number,
  networkPassphrase: string,
  address: string
): Promise<string> {
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(unsignedEntryXdr, "base64");

  try {
    const signedEntry = await authorizeEntry(
      entry,
      async (preimage) => {
        const signedAuthEntry = await kitSignAuthEntry(preimage.toXDR("base64"), {
          networkPassphrase,
          address,
        });
        return Buffer.from(signedAuthEntry, "base64");
      },
      validUntilLedgerSeq,
      networkPassphrase
    );
    return signedEntry.toXDR("base64");
  } catch (e) {
    // Fallback for wallets whose `signAuthEntry` signs the whole entry XDR itself (rather than
    // just the preimage) and hands back a fully-formed signed entry instead of a raw signature.
    const msg = e instanceof Error ? e.message : String(e);
    const looksLikePreimageMismatch =
      /pars|invalid|xdr/i.test(msg) && !/rejected|denied|declined/i.test(msg);
    if (!looksLikePreimageMismatch) throw e;

    const cloned = xdr.SorobanAuthorizationEntry.fromXDR(unsignedEntryXdr, "base64");
    cloned.credentials().address().signatureExpirationLedger(validUntilLedgerSeq);
    return kitSignAuthEntry(cloned.toXDR("base64"), { networkPassphrase, address });
  }
}

/**
 * Signs a Kairos delegation hash with the connected wallet's SEP-53 `signMessage`, for delegations
 * whose `delegator` is a CustomAccount smart wallet. Wallets deliberately refuse to sign
 * arbitrary raw bytes (that's indistinguishable from signing a malicious transaction), so
 * the smart wallet's `is_valid_signature` instead verifies the SEP-53-wrapped payload:
 * `SHA-256("Stellar Signed Message:\n" + hex(hash))` — see
 * `contracts/soroban/contracts/custom-account/src/lib.rs`. This function passes the hash's
 * hex string as the SEP-53 message so the wallet produces a signature over exactly that.
 * Not every kit wallet implements SEP-43/53 message signing correctly (e.g. Albedo's is
 * explicitly non-compliant) — this will surface as a natural error from those wallets.
 */
export async function signDelegationHashWithWallet(
  hashHex: string,
  networkPassphrase: string,
  address: string
): Promise<string> {
  const signedMessage = await kitSignMessage(hashHex, { networkPassphrase, address });
  if (!signedMessage) {
    throw new Error("Wallet returned an empty signed message");
  }

  const sigBuffer = Buffer.from(signedMessage, "base64");

  if (sigBuffer.length !== 64) {
    throw new Error(
      `Expected a 64-byte ed25519 signature from the wallet, got ${sigBuffer.length} bytes`
    );
  }
  return sigBuffer.toString("hex");
}

// ── Balance ──

async function fetchBalance(
  address: string,
  networkPassphrase: string
): Promise<string> {
  const horizonUrl =
    horizonUrlFor(networkPassphrase);
  const server = new Horizon.Server(horizonUrl, {
    allowHttp: !horizonUrl.startsWith("https"),
  });

  try {
    const account = await server.loadAccount(address);
    const nativeBalance = account.balances.find(
      (b: { asset_type: string }) => b.asset_type === "native"
    );
    return nativeBalance?.balance ?? "0";
  } catch {
    return "0";
  }
}

// ── Connection flow ──

export type ConnectError =
  | "no-browser"
  | "no-extension"
  | "user-rejected"
  | "network-error"
  | "unknown";

export interface ConnectResult {
  success: boolean;
  wallet?: WalletState;
  error?: { kind: ConnectError; message: string };
}

/**
 * Given an address already authorized by a kit wallet (our own connect-wallet picker calls
 * `kitConnectWallet(id)` to get one — see components/ConnectWalletModal.tsx), resolves the rest
 * of the wallet state: network details and account balance from Horizon.
 */
export async function connectWallet(address: string): Promise<ConnectResult> {
  // 1. Browser check
  if (!isBrowser()) {
    return {
      success: false,
      error: { kind: "no-browser", message: "Not in a browser environment" },
    };
  }

  // 2. Network details
  let net: Awaited<ReturnType<typeof kitGetNetwork>>;
  try {
    net = await kitGetNetwork();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      error: {
        kind: "network-error",
        message: msg || "Failed to get network details",
      },
    };
  }

  if (!net.networkPassphrase) {
    return {
      success: false,
      error: { kind: "network-error", message: "Wallet did not report a network" },
    };
  }
  const networkPassphrase = net.networkPassphrase;
  const networkKey = Object.entries(Networks).find(([, v]) => v === networkPassphrase)?.[0];
  if (!networkKey) {
    return {
      success: false,
      error: {
        kind: "network-error",
        message: `Unrecognized wallet network passphrase: ${networkPassphrase}`,
      },
    };
  }
  const isTestnet = networkKey === "TESTNET" || networkKey === "FUTURENET";
  const sorobanRpcUrl = SOROBAN_RPC_URLS[networkPassphrase];
  if (!sorobanRpcUrl) {
    return {
      success: false,
      error: { kind: "network-error", message: `No Soroban RPC configured for ${networkKey}` },
    };
  }

  // 3. Fetch balance
  const balance = await fetchBalance(address, networkPassphrase);

  return {
    success: true,
    wallet: {
      address,
      network: networkKey,
      networkPassphrase,
      sorobanRpcUrl,
      balance,
      isTestnet,
    },
  };
}

/** Fully disconnects the active kit wallet (clears its persisted selection too). */
export async function disconnectWallet(): Promise<void> {
  if (!isBrowser()) return;
  try {
    await kitDisconnect();
  } catch {
    // best-effort — local app state is cleared by the caller regardless
  }
}

// ── Delegate (send XLM — Horizon for classic accounts, Soroban SAC for contracts) ──

/** Convert a decimal XLM amount string (e.g. "12.5") to stroops (1 XLM = 1e7 stroops). */
function amountToStroops(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  const fracPadded = (frac + "0000000").slice(0, 7);
  return BigInt(whole || "0") * BigInt(10_000_000) + BigInt(fracPadded || "0");
}

async function pollSorobanTransaction(
  server: rpc.Server,
  txHash: string,
  maxAttempts = 20,
  intervalMs = 2000
): Promise<{ status: string; error?: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await server.getTransaction(txHash);
    if (res.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
      return {
        status: res.status,
        error:
          res.status === rpc.Api.GetTransactionStatus.FAILED
            ? "Transaction failed on-chain"
            : undefined,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { status: "PENDING" };
}

/**
 * Fund a smart wallet contract via the native XLM Stellar Asset Contract.
 * Classic `Operation.payment` only supports G-address destinations, so contract
 * (C-address) destinations must go through a Soroban `transfer` invocation instead.
 */
async function transferXLMToContract(
  sourceAddress: string,
  destination: string,
  amount: string,
  networkPassphrase: string,
  sorobanRpcUrl: string
): Promise<DelegationResult> {
  const server = new rpc.Server(sorobanRpcUrl, {
    allowHttp: !sorobanRpcUrl.startsWith("https"),
  });

  let account;
  try {
    account = await server.getAccount(sourceAddress);
  } catch {
    throw new Error(
      "Could not load Stellar account. Is it funded with testnet XLM?"
    );
  }

  const nativeSacId = Asset.native().contractId(networkPassphrase);
  const transferOp = Operation.invokeContractFunction({
    contract: nativeSacId,
    function: "transfer",
    args: [
      Address.fromString(sourceAddress).toScVal(),
      Address.fromString(destination).toScVal(),
      nativeToScVal(amountToStroops(amount), { type: "i128" }),
    ],
  });

  const builtTx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(transferOp)
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(builtTx);
  if (!rpc.Api.isSimulationSuccess(simulated)) {
    const reason = rpc.Api.isSimulationError(simulated)
      ? simulated.error
      : "unknown simulation error";
    throw new Error(`Failed to simulate smart wallet transfer: ${reason}`);
  }
  const assembled = rpc.assembleTransaction(builtTx, simulated).build();

  const signedXDR = await signWithWallet(
    assembled.toXDR(),
    networkPassphrase,
    sourceAddress
  );
  const signedTx = TransactionBuilder.fromXDR(signedXDR, networkPassphrase);

  const sendResponse = await server.sendTransaction(signedTx);
  if (sendResponse.status === "ERROR") {
    throw new Error("Failed to submit smart wallet transfer transaction");
  }

  const result = await pollSorobanTransaction(server, sendResponse.hash);
  if (result.status !== "SUCCESS") {
    throw new Error(
      result.error || `Smart wallet transfer ${result.status.toLowerCase()}`
    );
  }

  return { hash: sendResponse.hash, amount, destination };
}

/**
 * Withdraws native XLM from a smart wallet (custom account contract) to `destination` — the
 * owner's own G-address by default, or any other G-address (e.g. an agent's own Turnkey
 * Stellar account, for funding non-DCA strategy agents directly instead of via a delegation
 * that's never redeemed for those strategy types — see agentService.ts's setStrategy/startAgent
 * delegation gating, which is dca-only). Invokes the wallet's own `execute` entrypoint against
 * the native SAC's `transfer` function; the owner signs as the transaction's source account,
 * which satisfies the contract's `owner.require_auth()` via source-account credentials — no
 * separate signed auth entry (unlike deploy/delegation flows, where the funder pays fees
 * on the owner's behalf) is needed here since the owner pays their own fee directly.
 */
export async function withdrawFromSmartWallet(
  smartWalletAddress: string,
  amount: string,
  networkPassphrase: string,
  sorobanRpcUrl?: string,
  destination?: string
): Promise<DelegationResult> {
  const ownerAddress = await kitGetAddress();
  const recipient = destination ?? ownerAddress;
  const rpcUrl =
    sorobanRpcUrl ||
    sorobanRpcUrlFor(networkPassphrase);

  const server = new rpc.Server(rpcUrl, {
    allowHttp: !rpcUrl.startsWith("https"),
  });

  let account;
  try {
    account = await server.getAccount(ownerAddress);
  } catch {
    throw new Error("Could not load Stellar account. Is it funded with testnet XLM?");
  }

  const nativeSacId = Asset.native().contractId(networkPassphrase);
  const execOp = Operation.invokeContractFunction({
    contract: smartWalletAddress,
    function: "execute",
    args: [
      Address.fromString(nativeSacId).toScVal(),
      xdr.ScVal.scvSymbol("transfer"),
      xdr.ScVal.scvVec([
        Address.fromString(smartWalletAddress).toScVal(),
        Address.fromString(recipient).toScVal(),
        nativeToScVal(amountToStroops(amount), { type: "i128" }),
      ]),
    ],
  });

  const builtTx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(execOp)
    .setTimeout(30)
    .build();

  let simulated = await server.simulateTransaction(builtTx);
  if (!rpc.Api.isSimulationSuccess(simulated)) {
    const reason = rpc.Api.isSimulationError(simulated) ? simulated.error : "unknown simulation error";
    throw new Error(`Failed to simulate smart wallet withdrawal: ${reason}`);
  }

  // Ledger entries the withdrawal touches (the smart wallet's contract instance/storage, the
  // native SAC's balance entry) can have their TTL expire from disuse and get archived —
  // simulation still reports success in that case (`isSimulationSuccess` only checks for
  // `transactionData`), but submitting the tx as-is fails on-chain with an archived-entry error.
  // Restore those entries first, then re-simulate against live state before building for real.
  if (rpc.Api.isSimulationRestore(simulated)) {
    const restoreFee = String(Number(BASE_FEE) + Number(simulated.restorePreamble.minResourceFee));
    const restoreTx = new TransactionBuilder(account, { fee: restoreFee, networkPassphrase })
      .setSorobanData(simulated.restorePreamble.transactionData.build())
      .addOperation(Operation.restoreFootprint({}))
      .setTimeout(30)
      .build();

    const signedRestoreXDR = await signWithWallet(restoreTx.toXDR(), networkPassphrase, ownerAddress);
    const signedRestoreTx = TransactionBuilder.fromXDR(signedRestoreXDR, networkPassphrase);
    const restoreSend = await server.sendTransaction(signedRestoreTx);
    if (restoreSend.status === "ERROR") {
      throw new Error("Failed to submit smart wallet restore transaction");
    }
    const restoreResult = await pollSorobanTransaction(server, restoreSend.hash);
    if (restoreResult.status !== "SUCCESS") {
      throw new Error(restoreResult.error || `Smart wallet restore ${restoreResult.status.toLowerCase()}`);
    }

    account = await server.getAccount(ownerAddress);
    const rebuiltTx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(execOp)
      .setTimeout(30)
      .build();
    simulated = await server.simulateTransaction(rebuiltTx);
    if (!rpc.Api.isSimulationSuccess(simulated)) {
      const reason = rpc.Api.isSimulationError(simulated) ? simulated.error : "unknown simulation error";
      throw new Error(`Failed to simulate smart wallet withdrawal after restore: ${reason}`);
    }
    const assembled = rpc.assembleTransaction(rebuiltTx, simulated).build();
    const signedXDR = await signWithWallet(assembled.toXDR(), networkPassphrase, ownerAddress);
    const signedTx = TransactionBuilder.fromXDR(signedXDR, networkPassphrase);
    const sendResponse = await server.sendTransaction(signedTx);
    if (sendResponse.status === "ERROR") {
      throw new Error("Failed to submit smart wallet withdrawal transaction");
    }
    const result = await pollSorobanTransaction(server, sendResponse.hash);
    if (result.status !== "SUCCESS") {
      throw new Error(result.error || `Smart wallet withdrawal ${result.status.toLowerCase()}`);
    }
    return { hash: sendResponse.hash, amount, destination: recipient };
  }

  const assembled = rpc.assembleTransaction(builtTx, simulated).build();

  const signedXDR = await signWithWallet(assembled.toXDR(), networkPassphrase, ownerAddress);
  const signedTx = TransactionBuilder.fromXDR(signedXDR, networkPassphrase);

  const sendResponse = await server.sendTransaction(signedTx);
  if (sendResponse.status === "ERROR") {
    throw new Error("Failed to submit smart wallet withdrawal transaction");
  }

  const result = await pollSorobanTransaction(server, sendResponse.hash);
  if (result.status !== "SUCCESS") {
    throw new Error(result.error || `Smart wallet withdrawal ${result.status.toLowerCase()}`);
  }

  return { hash: sendResponse.hash, amount, destination: recipient };
}

export async function delegateXLM(
  amount: string,
  destination: string,
  networkPassphrase: string,
  sorobanRpcUrl?: string
): Promise<DelegationResult> {
  const sourceAddress = await kitGetAddress();

  // Smart wallets are Soroban contracts (C-addresses) — classic payments can't reach them.
  if (StrKey.isValidContract(destination)) {
    const rpcUrl =
      sorobanRpcUrl ||
      sorobanRpcUrlFor(networkPassphrase);
    return transferXLMToContract(
      sourceAddress,
      destination,
      amount,
      networkPassphrase,
      rpcUrl
    );
  }

  const horizonUrl =
    horizonUrlFor(networkPassphrase);
  const server = new Horizon.Server(horizonUrl, {
    allowHttp: !horizonUrl.startsWith("https"),
  });

  let account;
  try {
    account = await server.loadAccount(sourceAddress);
  } catch {
    throw new Error(
      "Could not load Stellar account. Is it funded with testnet XLM?"
    );
  }

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount,
      })
    )
    .setTimeout(30)
    .build();

  const signedXDR = await signWithWallet(
    transaction.toXDR(),
    networkPassphrase,
    sourceAddress
  );

  const signedTx = TransactionBuilder.fromXDR(signedXDR, networkPassphrase);
  const result = await server.submitTransaction(signedTx);

  return {
    hash: result.hash,
    amount,
    destination,
  };
}

// ── Smart wallet balance (Soroban SAC `balance`) ──
//
// Smart wallets are Soroban contracts (C-addresses) — classic Horizon `loadAccount` (used by
// `fetchAccountBalances` below) only understands G-addresses and fails/hangs on a contract
// address. Any token balance for a smart wallet must instead be read via that token's Stellar
// Asset Contract `balance` entrypoint, simulated through Soroban RPC.

/** Read a smart wallet's balance of an arbitrary token (identified by its SAC contract id). */
export async function fetchSmartWalletTokenBalance(
  smartWalletAddress: string,
  tokenContractId: string,
  networkPassphrase: string,
  sorobanRpcUrl?: string
): Promise<string> {
  const rpcUrl =
    sorobanRpcUrl ||
    sorobanRpcUrlFor(networkPassphrase);
  const server = new rpc.Server(rpcUrl, {
    allowHttp: !rpcUrl.startsWith("https"),
  });

  const sourceAddress = await kitGetAddress();
  const account = await server.getAccount(sourceAddress);

  const balanceOp = Operation.invokeContractFunction({
    contract: tokenContractId,
    function: "balance",
    args: [Address.fromString(smartWalletAddress).toScVal()],
  });

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(balanceOp)
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(simulated) || !simulated.result) {
    return "0";
  }
  const stroops = scValToBigInt(simulated.result.retval);
  return (Number(stroops) / 1e7).toFixed(7);
}

/** Read a smart wallet's native XLM balance via the native asset's Stellar Asset Contract. */
export async function fetchSmartWalletBalance(
  smartWalletAddress: string,
  networkPassphrase: string,
  sorobanRpcUrl?: string
): Promise<string> {
  return fetchSmartWalletTokenBalance(
    smartWalletAddress,
    Asset.native().contractId(networkPassphrase),
    networkPassphrase,
    sorobanRpcUrl
  );
}

// ── Real on-chain DEX swaps (Stellar path payments) ──
//
// Only XLM and real Stellar-issued assets can be swapped here — nothing else in this file's
// price feeds (BTC/ETH/SOL/etc. from Binance) correspond to actual Stellar assets, so those
// stay display-only until a real bridge or synthetic settlement layer exists.

/** Circle's official testnet USDC issuer — confirmed to have live testnet DEX order-book depth. */
export const TESTNET_USDC_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Mainnet USDC issuer, set via env once a mainnet deployment exists — never hardcoded here (see
 *  usdcIssuerForNetwork below, which fails loudly on mainnet if this isn't configured, rather
 *  than silently quoting/reading balances against the testnet issuer). */
const MAINNET_USDC_ISSUER = process.env.NEXT_PUBLIC_MAINNET_USDC_ISSUER;

/** Picks the right USDC issuer for whatever network the connected wallet is actually on — never
 *  silently falls back to the testnet issuer for a mainnet wallet. */
export function usdcIssuerForNetwork(networkPassphrase: string): string {
  if (networkPassphrase === Networks.PUBLIC) {
    if (!MAINNET_USDC_ISSUER) {
      throw new Error(
        "Mainnet USDC issuer is not configured (set NEXT_PUBLIC_MAINNET_USDC_ISSUER)."
      );
    }
    return MAINNET_USDC_ISSUER;
  }
  return TESTNET_USDC_ISSUER;
}

export interface SwapAsset {
  code: string;
  issuer?: string; // omitted for native XLM
}

export function swapAssetToStellarAsset(a: SwapAsset): Asset {
  return a.issuer ? new Asset(a.code, a.issuer) : Asset.native();
}

export interface AccountBalance {
  code: string;
  issuer?: string;
  balance: string;
}

/** Reads every trustline balance (including native XLM) for a connected wallet. */
export async function fetchAccountBalances(
  address: string,
  networkPassphrase: string
): Promise<AccountBalance[]> {
  const horizonUrl = horizonUrlFor(networkPassphrase);
  const server = new Horizon.Server(horizonUrl, {
    allowHttp: !horizonUrl.startsWith("https"),
  });

  try {
    const account = await server.loadAccount(address);
    return account.balances.map((b) => {
      if (b.asset_type === "native") {
        return { code: "XLM", balance: b.balance };
      }
      const credit = b as { asset_code: string; asset_issuer: string; balance: string };
      return { code: credit.asset_code, issuer: credit.asset_issuer, balance: credit.balance };
    });
  } catch (e) {
    // An unfunded/not-yet-created account is a valid zero-balance state, not a fetch failure —
    // Horizon 404s until the account receives its first payment.
    if ((e as { response?: { status?: number } }).response?.status === 404) {
      return [];
    }
    throw e;
  }
}

export interface OrderBookQuote {
  hasLiquidity: boolean;
  /** Units of `buying` received per 1 unit of `selling`, from the best bid/ask. */
  price: number | null;
}

/** Reads the live price for a pair, preferring a real AMM liquidity pool's spot price over the
 *  classic order book — testnet order books are thin and often carry stale dust offers (e.g. a
 *  resting offer priced at 1.0 that has nothing to do with the real rate), while liquidity pools
 *  carry deep, continuously-arbitraged reserves and give a far more trustworthy price. Falls
 *  back to the order book only if no pool exists for this exact asset pair.
 *
 *  Horizon's order book is keyed by (selling, buying) = (base, counter). `asks` are offers to
 *  sell the base asset (same side as us — never our counterparty); `bids` are offers to *buy*
 *  the base asset, i.e. exactly the counterparties who will take the base asset we're selling
 *  in exchange for the counter asset. Since this function is always called with
 *  `selling` = what the user is giving up, the correct top-of-book price is `bids[0]`, not
 *  `asks[0]`. */
export async function fetchOrderBookQuote(
  selling: SwapAsset,
  buying: SwapAsset,
  networkPassphrase: string
): Promise<OrderBookQuote> {
  const horizonUrl = horizonUrlFor(networkPassphrase);
  const server = new Horizon.Server(horizonUrl, {
    allowHttp: !horizonUrl.startsWith("https"),
  });

  const sellingAsset = swapAssetToStellarAsset(selling);
  const buyingAsset = swapAssetToStellarAsset(buying);

  const pools = await server.liquidityPools().forAssets(sellingAsset, buyingAsset).call();
  const pool = pools.records[0];
  if (pool) {
    const sellingReserve = pool.reserves.find((r) => r.asset === assetToReserveKey(sellingAsset));
    const buyingReserve = pool.reserves.find((r) => r.asset === assetToReserveKey(buyingAsset));
    if (sellingReserve && buyingReserve) {
      const sellingAmount = parseFloat(sellingReserve.amount);
      const buyingAmount = parseFloat(buyingReserve.amount);
      if (sellingAmount > 0) {
        return { hasLiquidity: true, price: buyingAmount / sellingAmount };
      }
    }
  }

  const book = await server.orderbook(sellingAsset, buyingAsset).call();
  const bestBid = book.bids[0];
  if (!bestBid) return { hasLiquidity: false, price: null };
  return { hasLiquidity: true, price: parseFloat(bestBid.price) };
}

/** Horizon's liquidity pool `reserves[].asset` field uses the same "native" / "CODE:ISSUER"
 *  string format as its other asset representations — matches Asset#toString(). */
function assetToReserveKey(asset: Asset): string {
  return asset.isNative() ? "native" : asset.toString();
}

export interface SwapResult {
  hash: string;
  sourceAmount: string;
  destAsset: SwapAsset;
}

async function loadAccountForSwap(server: Horizon.Server, sourceAddress: string) {
  try {
    return await server.loadAccount(sourceAddress);
  } catch {
    throw new Error("Could not load Stellar account. Is it funded with testnet XLM?");
  }
}

function hasTrustline(
  account: Awaited<ReturnType<Horizon.Server["loadAccount"]>>,
  asset: SwapAsset
): boolean {
  if (!asset.issuer) return true; // native XLM never needs a trustline
  return account.balances.some(
    (b) =>
      b.asset_type !== "native" &&
      (b as { asset_code: string; asset_issuer: string }).asset_code === asset.code &&
      (b as { asset_code: string; asset_issuer: string }).asset_issuer === asset.issuer
  );
}

/** A non-native asset needs a trustline before the account can hold it — whether it's being
 *  sent (you must already hold it to spend it) or received (you must trust it to receive it). */
function assertHasTrustline(
  account: Awaited<ReturnType<Horizon.Server["loadAccount"]>>,
  asset: SwapAsset
) {
  if (!hasTrustline(account, asset)) {
    throw new Error(
      `No trustline for ${asset.code}. Add a trustline to this asset in your wallet before trading it.`
    );
  }
}

/** Establishes a trustline (via a real signed `changeTrust` operation) so the connected wallet
 *  can hold a non-native asset like testnet USDC. Required once before it can be sent or
 *  received in a swap. */
export async function addTrustline(
  sourceAddress: string,
  asset: SwapAsset,
  networkPassphrase: string
): Promise<string> {
  if (!asset.issuer) throw new Error("Native XLM does not need a trustline");
  const horizonUrl = horizonUrlFor(networkPassphrase);
  const server = new Horizon.Server(horizonUrl, { allowHttp: !horizonUrl.startsWith("https") });

  const account = await loadAccountForSwap(server, sourceAddress);
  const op = Operation.changeTrust({ asset: swapAssetToStellarAsset(asset) });
  const hash = await submitSwap(server, account, op, networkPassphrase);
  return hash;
}

async function submitSwap(
  server: Horizon.Server,
  account: Awaited<ReturnType<Horizon.Server["loadAccount"]>>,
  op: xdr.Operation,
  networkPassphrase: string
): Promise<string> {
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const signedXDR = await signWithWallet(transaction.toXDR(), networkPassphrase, account.accountId());
  const signedTx = TransactionBuilder.fromXDR(signedXDR, networkPassphrase);

  try {
    const result = await server.submitTransaction(signedTx);
    return result.hash;
  } catch (e) {
    const horizonError = e as { response?: { data?: { extras?: { result_codes?: unknown } } } };
    const codes = horizonError.response?.data?.extras?.result_codes;
    if (codes) {
      throw new Error(`Swap failed: ${JSON.stringify(codes)}`);
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/**
 * Executes a real on-chain swap via a Stellar path payment (strict send): the connected
 * connected wallet pays exactly `sendAmount` of `sendAsset`, routed through the DEX order book,
 * and receives whatever `destAsset` amount the book fills at (must be >= destMin or the
 * transaction fails on-chain — real slippage protection, not a UI-only check).
 * Use this when the user is fixing how much they're *sending* (e.g. "sell exactly N XLM").
 */
export async function executeSwap(params: {
  sourceAddress: string;
  sendAsset: SwapAsset;
  sendAmount: string;
  destAsset: SwapAsset;
  destMin: string;
  networkPassphrase: string;
}): Promise<SwapResult> {
  const { sourceAddress, sendAsset, sendAmount, destAsset, destMin, networkPassphrase } = params;
  const horizonUrl = horizonUrlFor(networkPassphrase);
  const server = new Horizon.Server(horizonUrl, { allowHttp: !horizonUrl.startsWith("https") });

  const account = await loadAccountForSwap(server, sourceAddress);
  // Sending a non-native asset requires already holding a trustline to it; receiving one
  // requires trusting it too — check whichever side of this swap isn't native XLM.
  assertHasTrustline(account, sendAsset);
  assertHasTrustline(account, destAsset);

  const op = Operation.pathPaymentStrictSend({
    sendAsset: swapAssetToStellarAsset(sendAsset),
    sendAmount,
    destination: sourceAddress,
    destAsset: swapAssetToStellarAsset(destAsset),
    destMin,
  });

  const hash = await submitSwap(server, account, op, networkPassphrase);
  return { hash, sourceAmount: sendAmount, destAsset };
}

/**
 * Executes a real on-chain swap via a Stellar path payment (strict receive): the connected
 * connected wallet receives exactly `destAmount` of `destAsset`, paying up to `sendMax` of
 * `sendAsset` (fails on-chain if the book can't fill within that cap — real slippage
 * protection). Use this when the user is fixing how much they want to *receive* (e.g.
 * "buy exactly N XLM").
 */
export async function executeSwapStrictReceive(params: {
  sourceAddress: string;
  sendAsset: SwapAsset;
  sendMax: string;
  destAsset: SwapAsset;
  destAmount: string;
  networkPassphrase: string;
}): Promise<SwapResult> {
  const { sourceAddress, sendAsset, sendMax, destAsset, destAmount, networkPassphrase } = params;
  const horizonUrl = horizonUrlFor(networkPassphrase);
  const server = new Horizon.Server(horizonUrl, { allowHttp: !horizonUrl.startsWith("https") });

  const account = await loadAccountForSwap(server, sourceAddress);
  assertHasTrustline(account, sendAsset);
  assertHasTrustline(account, destAsset);

  const op = Operation.pathPaymentStrictReceive({
    sendAsset: swapAssetToStellarAsset(sendAsset),
    sendMax,
    destination: sourceAddress,
    destAsset: swapAssetToStellarAsset(destAsset),
    destAmount,
  });

  const hash = await submitSwap(server, account, op, networkPassphrase);
  return { hash, sourceAmount: sendMax, destAsset };
}
