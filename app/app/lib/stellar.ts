import {
  Horizon,
  Networks,
  Asset,
  Operation,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import {
  requestAccess,
  getAddress,
  getNetworkDetails,
  isConnected,
  signTransaction,
} from "@stellar/freighter-api";

// ── Constants ──

const HORIZON_URLS: Record<string, string> = {
  [Networks.PUBLIC]: "https://horizon.stellar.org",
  [Networks.TESTNET]: "https://horizon-testnet.stellar.org",
  [Networks.FUTURENET]: "https://horizon-futurenet.stellar.org",
};

// ── Types ──

export interface WalletState {
  address: string;
  network: string;
  networkPassphrase: string;
  balance: string;
  isTestnet: boolean;
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

/** Check if the Freighter extension is installed at all. */
function freighterInstalled(): boolean {
  if (!isBrowser()) return false;
  return !!((window as any).freighter || (window as any).stellar);
}

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
  if (!isBrowser() || !freighterInstalled()) return false;
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

  // 2. Freighter extension check
  if (!freighterInstalled()) {
    return {
      success: false,
      error: {
        kind: "no-extension",
        message: "Freighter extension not detected",
      },
    };
  }

  // 3. Request access (pops up Freighter)
  let address: string;
  try {
    address = await requestAccessFromFreighter();
  } catch (e: any) {
    const msg = e?.message ?? "";
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
  } catch (e: any) {
    return {
      success: false,
      error: {
        kind: "network-error",
        message: e?.message ?? "Failed to get network details",
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
      balance,
      isTestnet,
    },
  };
}

// ── Delegate (send XLM) ──

export async function delegateXLM(
  amount: string,
  destination: string,
  networkPassphrase: string
): Promise<DelegationResult> {
  // 1. Get source address (must already be authorized)
  const sourceAddress = await getAddressFromFreighter();

  const horizonUrl =
    HORIZON_URLS[networkPassphrase] ?? HORIZON_URLS[Networks.TESTNET];
  const server = new Horizon.Server(horizonUrl, {
    allowHttp: !horizonUrl.startsWith("https"),
  });

  // 2. Load source account
  let account;
  try {
    account = await server.loadAccount(sourceAddress);
  } catch {
    throw new Error(
      "Could not load Stellar account. Is it funded with testnet XLM?"
    );
  }

  // 3. Build transaction
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

  // 4. Sign with Freighter
  const signedXDR = await signWithFreighter(
    transaction.toXDR(),
    networkPassphrase
  );

  // 5. Submit
  const signedTx = TransactionBuilder.fromXDR(signedXDR, networkPassphrase);
  const result = await server.submitTransaction(signedTx);

  return {
    hash: result.hash,
    amount,
    destination,
  };
}
