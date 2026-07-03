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
  requestAccess,
  getAddress,
  getNetworkDetails,
  isConnected,
  signTransaction,
  signAuthEntry,
  signMessage,
} from "@stellar/freighter-api";

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

// ── Browser guard (Freighter only runs in the browser) ──

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

// ── Freighter helpers ──

/** Safely read the address from a freighter-api response. */
function unwrapAddress(
  res: { address?: string; error?: string }
): string {
  if (res.error) throw new Error(res.error);
  if (!res.address) throw new Error("Freighter returned an empty address");
  return res.address;
}

/** Prompt the user for access (popup) and return their public key. */
async function requestAccessFromFreighter(): Promise<string> {
  const res = await requestAccess();
  return unwrapAddress(res);
}

/** Get the address without prompting (fails if not already authorized). */
async function getAddressFromFreighter(): Promise<string> {
  const res = await getAddress();
  return unwrapAddress(res);
}

/** Get network details. */
async function getFreighterNetwork(): Promise<{
  network: string;
  networkPassphrase: string;
  sorobanRpcUrl: string;
}> {
  const res = await getNetworkDetails();
  if (res.error) {
    throw new Error(`Freighter network error: ${res.error}`);
  }
  return {
    network: res.network ?? "",
    networkPassphrase: res.networkPassphrase ?? "",
    sorobanRpcUrl: res.sorobanRpcUrl ?? "",
  };
}

/** Check if Freighter has already authorized this app. */
export async function tryCheckConnection(): Promise<boolean> {
  if (!isBrowser()) return false;
  try {
    const res = await isConnected();
    // `isConnected` returns `{ isConnected: boolean | object, error?: string }`
    // When the extension is installed, `isConnected` may be the extension object (truthy).
    if (res.error) return false;
    return !!res.isConnected;
  } catch {
    return false;
  }
}

/** Sign a transaction XDR with Freighter's popup. */
async function signWithFreighter(
  xdr: string,
  networkPassphrase: string
): Promise<string> {
  const res = await signTransaction(xdr, { networkPassphrase });
  if (res.error) {
    throw new Error(`Freighter signing error: ${res.error}`);
  }
  if (!res.signedTxXdr) {
    throw new Error("Freighter returned an empty signed transaction");
  }
  return res.signedTxXdr;
}

/**
 * Sign a single Soroban authorization entry with Freighter — used for sponsored
 * contract calls where a server-side funder pays transaction fees but the connected
 * wallet must still separately authorize its own address's participation (e.g. the
 * `CreateContract` call when deploying a smart wallet on behalf of this address).
 *
 * Freighter's `signAuthEntry` signs the entry's `HashIdPreimage` (the payload that
 * gets hashed for the signature), not the full `SorobanAuthorizationEntry` XDR —
 * passing the whole entry causes Freighter to fail with "Invalid Authorization
 * Entry ... XDR could not be parsed". `authorizeEntry` (from stellar-sdk) drives
 * that exact preimage/signature handshake and splices the result back into a
 * fully-signed entry.
 */
export async function signAuthEntryWithFreighter(
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
        const res = await signAuthEntry(preimage.toXDR("base64"), {
          networkPassphrase,
          address,
        });
        if (res.error) {
          throw new Error(`Freighter auth-entry signing error: ${res.error}`);
        }
        if (!res.signedAuthEntry) {
          throw new Error("Freighter returned an empty signed auth entry");
        }
        return Buffer.from(res.signedAuthEntry, "base64");
      },
      validUntilLedgerSeq,
      networkPassphrase
    );
    return signedEntry.toXDR("base64");
  } catch (e) {
    // Fallback for older/newer Freighter builds whose `signAuthEntry` signs the
    // whole entry XDR itself (rather than just the preimage) and hands back a
    // fully-formed signed entry instead of a raw signature.
    const msg = e instanceof Error ? e.message : String(e);
    const looksLikePreimageMismatch =
      /pars|invalid|xdr/i.test(msg) && !/rejected|denied|declined/i.test(msg);
    if (!looksLikePreimageMismatch) throw e;

    const cloned = xdr.SorobanAuthorizationEntry.fromXDR(unsignedEntryXdr, "base64");
    cloned.credentials().address().signatureExpirationLedger(validUntilLedgerSeq);
    const res = await signAuthEntry(cloned.toXDR("base64"), {
      networkPassphrase,
      address,
    });
    if (res.error) {
      throw new Error(`Freighter auth-entry signing error: ${res.error}`);
    }
    if (!res.signedAuthEntry) {
      throw new Error("Freighter returned an empty signed auth entry");
    }
    // Some Freighter versions return the fully-signed entry XDR directly here.
    return res.signedAuthEntry;
  }
}

/**
 * Signs a Kairos delegation hash with Freighter's SEP-53 `signMessage`, for delegations
 * whose `delegator` is a CustomAccount smart wallet. Wallets deliberately refuse to sign
 * arbitrary raw bytes (that's indistinguishable from signing a malicious transaction), so
 * the smart wallet's `is_valid_signature` instead verifies the SEP-53-wrapped payload:
 * `SHA-256("Stellar Signed Message:\n" + hex(hash))` — see
 * `contracts/soroban/contracts/custom-account/src/lib.rs`. This function passes the hash's
 * hex string as the SEP-53 message so Freighter produces a signature over exactly that.
 *
 * Freighter's `signMessage` response shape has changed across versions — `signedMessage` is
 * either a `Buffer` of the raw 64-byte signature (older/"V3") or a string (newer/"V4",
 * base64-encoded). Both are normalized to a hex string here.
 */
export async function signDelegationHashWithFreighter(
  hashHex: string,
  networkPassphrase: string,
  address: string
): Promise<string> {
  const res = await signMessage(hashHex, { networkPassphrase, address });
  if (res.error) {
    throw new Error(`Freighter message-signing error: ${res.error}`);
  }
  const { signedMessage } = res;
  if (!signedMessage) {
    throw new Error("Freighter returned an empty signed message");
  }

  const sigBuffer =
    typeof signedMessage === "string"
      ? Buffer.from(signedMessage, "base64")
      : Buffer.from(signedMessage);

  if (sigBuffer.length !== 64) {
    throw new Error(
      `Expected a 64-byte ed25519 signature from Freighter, got ${sigBuffer.length} bytes`
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
    HORIZON_URLS[networkPassphrase] ?? HORIZON_URLS[Networks.TESTNET];
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
 * Attempt to connect Freighter, prompt the user via popup, and fetch
 * the account balance from Horizon.
 */
export async function connectWallet(): Promise<ConnectResult> {
  // 1. Browser check
  if (!isBrowser()) {
    return {
      success: false,
      error: { kind: "no-browser", message: "Not in a browser environment" },
    };
  }

  // 2. Detect whether the extension is even installed. `isConnected()` talks to the
  // content script directly; if that channel errors out there's no extension to relay
  // through (as opposed to a real network/API error surfaced later).
  const connectivity = await isConnected();
  if (connectivity.error) {
    return {
      success: false,
      error: {
        kind: "no-extension",
        message: "Freighter extension not found. Install it from freighter.app",
      },
    };
  }

  // 3. Request access (pops up Freighter)
  let address: string;
  try {
    address = await requestAccessFromFreighter();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // User closed the popup or denied access
    if (
      msg.includes("cancel") ||
      msg.includes("deny") ||
      msg.includes("reject") ||
      msg.includes("User declined")
    ) {
      return {
        success: false,
        error: { kind: "user-rejected", message: "Access denied by user" },
      };
    }
    return {
      success: false,
      error: { kind: "unknown", message: msg || "Failed to request access" },
    };
  }

  // 4. Network details
  let net: Awaited<ReturnType<typeof getFreighterNetwork>>;
  try {
    net = await getFreighterNetwork();
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

  const networkPassphrase = net.networkPassphrase || Networks.TESTNET;
  const networkKey =
    Object.entries(Networks).find(
      ([, v]) => v === networkPassphrase
    )?.[0] ?? "TESTNET";
  const isTestnet = networkKey === "TESTNET" || networkKey === "FUTURENET";

  // 5. Fetch balance
  const balance = await fetchBalance(address, networkPassphrase);

  return {
    success: true,
    wallet: {
      address,
      network: networkKey,
      networkPassphrase,
      sorobanRpcUrl:
        net.sorobanRpcUrl || SOROBAN_RPC_URLS[networkPassphrase] || SOROBAN_RPC_URLS[Networks.TESTNET],
      balance,
      isTestnet,
    },
  };
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

  const signedXDR = await signWithFreighter(
    assembled.toXDR(),
    networkPassphrase
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

export async function delegateXLM(
  amount: string,
  destination: string,
  networkPassphrase: string,
  sorobanRpcUrl?: string
): Promise<DelegationResult> {
  const sourceAddress = await getAddressFromFreighter();

  // Smart wallets are Soroban contracts (C-addresses) — classic payments can't reach them.
  if (StrKey.isValidContract(destination)) {
    const rpcUrl =
      sorobanRpcUrl ||
      SOROBAN_RPC_URLS[networkPassphrase] ||
      SOROBAN_RPC_URLS[Networks.TESTNET];
    return transferXLMToContract(
      sourceAddress,
      destination,
      amount,
      networkPassphrase,
      rpcUrl
    );
  }

  const horizonUrl =
    HORIZON_URLS[networkPassphrase] ?? HORIZON_URLS[Networks.TESTNET];
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

  const signedXDR = await signWithFreighter(
    transaction.toXDR(),
    networkPassphrase
  );

  const signedTx = TransactionBuilder.fromXDR(signedXDR, networkPassphrase);
  const result = await server.submitTransaction(signedTx);

  return {
    hash: result.hash,
    amount,
    destination,
  };
}

// ── Smart wallet balance (Soroban native SAC `balance`) ──

/** Read a smart wallet's native XLM balance via the native asset's Stellar Asset Contract. */
export async function fetchSmartWalletBalance(
  smartWalletAddress: string,
  networkPassphrase: string,
  sorobanRpcUrl?: string
): Promise<string> {
  const rpcUrl =
    sorobanRpcUrl ||
    SOROBAN_RPC_URLS[networkPassphrase] ||
    SOROBAN_RPC_URLS[Networks.TESTNET];
  const server = new rpc.Server(rpcUrl, {
    allowHttp: !rpcUrl.startsWith("https"),
  });

  const sourceAddress = await getAddressFromFreighter();
  const account = await server.getAccount(sourceAddress);

  const nativeSacId = Asset.native().contractId(networkPassphrase);
  const balanceOp = Operation.invokeContractFunction({
    contract: nativeSacId,
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

// ── Real on-chain DEX swaps (Stellar path payments) ──
//
// Only XLM and real Stellar-issued assets can be swapped here — nothing else in this file's
// price feeds (BTC/ETH/SOL/etc. from Binance) correspond to actual Stellar assets, so those
// stay display-only until a real bridge or synthetic settlement layer exists.

/** Circle's official testnet USDC issuer — confirmed to have live testnet DEX order-book depth. */
export const TESTNET_USDC_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

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
  const horizonUrl = HORIZON_URLS[networkPassphrase] ?? HORIZON_URLS[Networks.TESTNET];
  const server = new Horizon.Server(horizonUrl, {
    allowHttp: !horizonUrl.startsWith("https"),
  });

  const account = await server.loadAccount(address);
  return account.balances.map((b) => {
    if (b.asset_type === "native") {
      return { code: "XLM", balance: b.balance };
    }
    const credit = b as { asset_code: string; asset_issuer: string; balance: string };
    return { code: credit.asset_code, issuer: credit.asset_issuer, balance: credit.balance };
  });
}

export interface OrderBookQuote {
  hasLiquidity: boolean;
  /** Units of `buying` received per 1 unit of `selling`, from the best bid/ask. */
  price: number | null;
}

/** Reads the live Stellar DEX order book for a pair — used to show a real price and refuse
 *  to submit a swap when there's no on-chain liquidity, instead of guessing. */
export async function fetchOrderBookQuote(
  selling: SwapAsset,
  buying: SwapAsset,
  networkPassphrase: string
): Promise<OrderBookQuote> {
  const horizonUrl = HORIZON_URLS[networkPassphrase] ?? HORIZON_URLS[Networks.TESTNET];
  const server = new Horizon.Server(horizonUrl, {
    allowHttp: !horizonUrl.startsWith("https"),
  });

  const book = await server
    .orderbook(swapAssetToStellarAsset(selling), swapAssetToStellarAsset(buying))
    .call();

  const bestAsk = book.asks[0];
  if (!bestAsk) return { hasLiquidity: false, price: null };
  return { hasLiquidity: true, price: parseFloat(bestAsk.price) };
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
      `No trustline for ${asset.code}. Add a trustline to this asset in Freighter before trading it.`
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
  const horizonUrl = HORIZON_URLS[networkPassphrase] ?? HORIZON_URLS[Networks.TESTNET];
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

  const signedXDR = await signWithFreighter(transaction.toXDR(), networkPassphrase);
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
 * Freighter wallet pays exactly `sendAmount` of `sendAsset`, routed through the DEX order book,
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
  const horizonUrl = HORIZON_URLS[networkPassphrase] ?? HORIZON_URLS[Networks.TESTNET];
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
 * Freighter wallet receives exactly `destAmount` of `destAsset`, paying up to `sendMax` of
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
  const horizonUrl = HORIZON_URLS[networkPassphrase] ?? HORIZON_URLS[Networks.TESTNET];
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
