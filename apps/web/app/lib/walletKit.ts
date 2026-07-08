"use client";

// The kit touches `window`/`localStorage` at module-evaluation time (not just call time), which
// crashes Next's server-side prerendering if it's ever pulled into the SSR bundle via a static
// import. Every export here loads it lazily via `import()` so it's only ever evaluated in the
// browser, after this file's own top-level code has already run.

let initialized = false;

async function loadKit() {
  const [
    { StellarWalletsKit, SwkAppDarkTheme, Networks: KitNetworks },
    { FreighterModule },
    { AlbedoModule },
    { xBullModule },
    { HotWalletModule },
    { RabetModule },
    { LobstrModule },
    { HanaModule },
    { KleverModule },
  ] = await Promise.all([
    import("@creit.tech/stellar-wallets-kit"),
    import("@creit.tech/stellar-wallets-kit/modules/freighter"),
    import("@creit.tech/stellar-wallets-kit/modules/albedo"),
    import("@creit.tech/stellar-wallets-kit/modules/xbull"),
    import("@creit.tech/stellar-wallets-kit/modules/hotwallet"),
    import("@creit.tech/stellar-wallets-kit/modules/rabet"),
    import("@creit.tech/stellar-wallets-kit/modules/lobstr"),
    import("@creit.tech/stellar-wallets-kit/modules/hana"),
    import("@creit.tech/stellar-wallets-kit/modules/klever"),
  ]);

  if (!initialized) {
    initialized = true;
    StellarWalletsKit.init({
      modules: [
        new FreighterModule(),
        new AlbedoModule(),
        new xBullModule(),
        new HotWalletModule(),
        new RabetModule(),
        new LobstrModule(),
        new HanaModule(),
        new KleverModule(),
      ],
      network: KitNetworks.TESTNET,
      theme: SwkAppDarkTheme,
    });
  }

  return StellarWalletsKit;
}

/** Opens the kit's wallet-picker modal (Freighter/Albedo/xBull/HOT Wallet/etc.) and returns the
 *  address of whichever wallet the user picked and authorized. Rejects if closed without one. */
export async function openWalletModal(): Promise<string> {
  const kit = await loadKit();
  const { address } = await kit.authModal();
  return address;
}

/** Reads the address the kit already has in memory for a previously-selected wallet, without
 *  prompting anything — used to silently restore a session across reloads. Rejects if no wallet
 *  has been selected yet. */
export async function kitGetAddress(): Promise<string> {
  const kit = await loadKit();
  const { address } = await kit.getAddress();
  return address;
}

export async function kitGetNetwork(): Promise<{ network: string; networkPassphrase: string }> {
  const kit = await loadKit();
  return kit.getNetwork();
}

export async function kitSetNetwork(network: "PUBLIC" | "TESTNET"): Promise<void> {
  const { StellarWalletsKit, Networks: KitNetworks } = await import("@creit.tech/stellar-wallets-kit");
  StellarWalletsKit.setNetwork(network === "PUBLIC" ? KitNetworks.PUBLIC : KitNetworks.TESTNET);
}

export async function kitSignTransaction(
  xdr: string,
  opts: { networkPassphrase: string; address: string }
): Promise<string> {
  const kit = await loadKit();
  const { signedTxXdr } = await kit.signTransaction(xdr, opts);
  return signedTxXdr;
}

export async function kitSignAuthEntry(
  authEntry: string,
  opts: { networkPassphrase: string; address: string }
): Promise<string> {
  const kit = await loadKit();
  const { signedAuthEntry } = await kit.signAuthEntry(authEntry, opts);
  return signedAuthEntry;
}

export async function kitSignMessage(
  message: string,
  opts: { networkPassphrase: string; address: string }
): Promise<string> {
  const kit = await loadKit();
  const { signedMessage } = await kit.signMessage(message, opts);
  return signedMessage;
}

export async function kitDisconnect(): Promise<void> {
  const kit = await loadKit();
  await kit.disconnect();
}

export interface KitWalletOption {
  id: string;
  name: string;
  icon: string;
  isAvailable: boolean;
}

/** Lists every wallet the kit knows about (Freighter/Albedo/xBull/etc.) along with whether each
 *  is actually installed/available right now — powers our own connect-wallet picker UI. */
export async function kitListWallets(): Promise<KitWalletOption[]> {
  const kit = await loadKit();
  const wallets = await kit.refreshSupportedWallets();
  return wallets.map((w) => ({ id: w.id, name: w.name, icon: w.icon, isAvailable: w.isAvailable }));
}

/** Selects a wallet by id and prompts it for the user's address — the same two calls the kit's
 *  own built-in modal makes internally when a wallet row is clicked. */
export async function kitConnectWallet(id: string): Promise<string> {
  const kit = await loadKit();
  kit.setWallet(id);
  const { address } = await kit.fetchAddress();
  return address;
}
