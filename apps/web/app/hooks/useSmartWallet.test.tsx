// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Regression tests for useSmartWallet's disconnect/reconnect sequencing: logout must clear every
// piece of cached state (session tokens in window.sessionStorage, smart-wallet list/selection and
// portfolio history in window.localStorage) so a reconnect always rebuilds from the DB/registry, never
// from a stale browser cache — see useSmartWallets.reset's docstring for why that invariant
// matters.

const OWNER = "GDOWNERPUBLICKEY0000000000000000000000000000000000000000";
const SMART_WALLET_ADDR = "CSMARTWALLETADDR000000000000000000000000000000000000000";

const connectWalletMock = vi.fn();
const disconnectWalletMock = vi.fn().mockResolvedValue(undefined);
const tryCheckConnectionMock = vi.fn().mockResolvedValue(false);
const kitGetAddressMock = vi.fn();
const kitConnectWalletMock = vi.fn();
const fetchSmartWalletBalanceMock = vi.fn().mockResolvedValue("100.0000000");
const listSmartWalletsMock = vi.fn().mockResolvedValue([]);
const challengeAndVerifyMock = vi.fn().mockResolvedValue("fake-session-token");

vi.mock("@/app/lib/stellar", () => ({
  connectWallet: (address: string) => connectWalletMock(address),
  disconnectWallet: () => disconnectWalletMock(),
  tryCheckConnection: () => tryCheckConnectionMock(),
  fetchSmartWalletBalance: (...args: unknown[]) => fetchSmartWalletBalanceMock(...args),
  signAuthEntryWithWallet: vi.fn(),
}));

vi.mock("@/app/lib/walletKit", () => ({
  kitGetAddress: () => kitGetAddressMock(),
  kitConnectWallet: (id: string) => kitConnectWalletMock(id),
}));

vi.mock("@/app/lib/agentsBackend", () => ({
  listSmartWallets: () => listSmartWalletsMock(),
  registerSmartWallet: vi.fn(),
  setAuthToken: vi.fn(),
  clearAllStoredSessionTokens: () => {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith("kairos:session:")) keys.push(key);
    }
    keys.forEach((k) => window.sessionStorage.removeItem(k));
  },
}));

vi.mock("@/app/lib/agentsAuth", () => {
  const key = (publicKey: string) => `kairos:session:${publicKey}`;
  return {
    getStoredSessionToken: (publicKey: string) => window.sessionStorage.getItem(key(publicKey)),
    clearStoredSessionToken: (publicKey: string) => window.sessionStorage.removeItem(key(publicKey)),
    challengeAndVerify: async (publicKey: string) => {
      const token = await challengeAndVerifyMock(publicKey);
      window.sessionStorage.setItem(key(publicKey), token);
      return token;
    },
  };
});

vi.mock("@/app/lib/connectApi", () => {
  class ConnectApiError extends Error {
    smartWallet?: string;
  }
  return {
    checkOnboarding: vi.fn().mockResolvedValue({ status: "new" }),
    ConnectApiError,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/dashboard",
}));

// Real module (not mocked) — session tokens are read/written straight to window.sessionStorage under
// this prefix, so tests assert against the real storage key rather than a mock's call args.
const SESSION_KEY_PREFIX = "kairos:session:";

import { useSmartWallet } from "./useSmartWallet";

function makeWallet() {
  return {
    address: OWNER,
    networkPassphrase: "Test SDF Network ; September 2015",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  };
}

function makeConnectResult() {
  return { success: true as const, wallet: makeWallet() };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllMocks();
  tryCheckConnectionMock.mockResolvedValue(false);
  challengeAndVerifyMock.mockResolvedValue("fake-session-token");
  fetchSmartWalletBalanceMock.mockResolvedValue("100.0000000");
  listSmartWalletsMock.mockResolvedValue([]);
  connectWalletMock.mockResolvedValue(makeConnectResult());
  window.sessionStorage.setItem(SESSION_KEY_PREFIX + OWNER, "fake-session-token");
  window.localStorage.setItem(`kairos:smart-wallets:${OWNER}`, JSON.stringify([{ address: SMART_WALLET_ADDR, label: null }]));
  window.localStorage.setItem(`kairos:smart-wallet:${OWNER}`, SMART_WALLET_ADDR);
  window.localStorage.setItem(`kairos:portfolio-snapshots:${OWNER}`, JSON.stringify([{ t: Date.now(), v: 123 }]));
});

async function connect(result: ReturnType<typeof renderHook<ReturnType<typeof useSmartWallet>, unknown>>) {
  await act(async () => {
    result.result.current.connect(true);
  });
  await act(async () => {
    await result.result.current.pickWallet("freighter");
  });
}

describe("useSmartWallet disconnect/reconnect", () => {
  it("logout clears the owner's window.sessionStorage session token", async () => {
    const hook = renderHook(() => useSmartWallet());
    await connect(hook);
    expect(window.sessionStorage.getItem(SESSION_KEY_PREFIX + OWNER)).not.toBeNull();

    act(() => {
      hook.result.current.disconnect();
    });

    expect(window.sessionStorage.getItem(SESSION_KEY_PREFIX + OWNER)).toBeNull();
  });

  it("logout clears the owner's window.localStorage smart-wallet cache", async () => {
    const hook = renderHook(() => useSmartWallet());
    await connect(hook);

    act(() => {
      hook.result.current.disconnect();
    });

    expect(window.localStorage.getItem(`kairos:smart-wallets:${OWNER}`)).toBeNull();
    expect(window.localStorage.getItem(`kairos:smart-wallet:${OWNER}`)).toBeNull();
  });

  it("logout clears cached portfolio snapshots", async () => {
    const hook = renderHook(() => useSmartWallet());
    await connect(hook);

    act(() => {
      hook.result.current.disconnect();
    });

    expect(window.localStorage.getItem(`kairos:portfolio-snapshots:${OWNER}`)).toBeNull();
  });

  it("logout resets in-memory smart wallet state", async () => {
    const hook = renderHook(() => useSmartWallet());
    await connect(hook);
    await waitFor(() => expect(hook.result.current.smartWalletAddress).toBe(SMART_WALLET_ADDR));

    act(() => {
      hook.result.current.disconnect();
    });

    expect(hook.result.current.wallet).toBeNull();
    expect(hook.result.current.smartWalletAddress).toBeNull();
    expect(hook.result.current.smartWallets).toEqual([]);
  });

  it("reconnect after logout restores state from the backend/local list, not stale cache", async () => {
    const hook = renderHook(() => useSmartWallet());
    await connect(hook);
    await waitFor(() => expect(hook.result.current.smartWalletAddress).toBe(SMART_WALLET_ADDR));

    act(() => {
      hook.result.current.disconnect();
    });
    expect(hook.result.current.smartWalletAddress).toBeNull();

    // Reconnect: backend now reports the (same) smart wallet — mergeSmartWallets rebuilds the
    // list purely from listSmartWallets() since the window.localStorage cache was wiped by reset().
    listSmartWalletsMock.mockResolvedValue([{ address: SMART_WALLET_ADDR, label: null }]);
    await connect(hook);

    await waitFor(() => expect(hook.result.current.smartWalletAddress).toBe(SMART_WALLET_ADDR));
    expect(hook.result.current.smartWallets).toEqual([{ address: SMART_WALLET_ADDR, label: null }]);
  });

  it("no stale smart wallet survives reconnect as a different owner (shared device)", async () => {
    const hook = renderHook(() => useSmartWallet());
    await connect(hook);
    await waitFor(() => expect(hook.result.current.smartWalletAddress).toBe(SMART_WALLET_ADDR));

    act(() => {
      hook.result.current.disconnect();
    });

    // A different owner connects on the same browser/tab next — must not inherit the previous
    // owner's smart wallet address since reset() only ever clears in-memory state on disconnect,
    // not other-owner storage; the new owner has no cache and no backend wallets of their own.
    const OTHER_OWNER = "GDOTHEROWNERPUBLICKEY000000000000000000000000000000000";
    window.sessionStorage.setItem(SESSION_KEY_PREFIX + OTHER_OWNER, "other-token");
    connectWalletMock.mockResolvedValue({
      success: true,
      wallet: { ...makeWallet(), address: OTHER_OWNER },
    });
    listSmartWalletsMock.mockResolvedValue([]);

    await connect(hook);

    expect(hook.result.current.smartWalletAddress).toBeNull();
    expect(hook.result.current.wallet?.address).toBe(OTHER_OWNER);
  });
});
