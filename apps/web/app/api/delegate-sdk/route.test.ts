import { describe, expect, it, vi, beforeEach } from "vitest";

// Regression test for the P0 bug: connect -> create -> logout -> login must restore the
// existing smart wallet, never deploy a second one. PREPARE_WALLET_DEPLOY is the last-resort
// gate before an on-chain deploy — it must refuse to prepare a new deploy when the registry
// already has a smart wallet for this owner, regardless of what the client's local/DB view says.

const ensureFundedTestnetAccount = vi.fn();
const prepareSponsoredDeploy = vi.fn();
const lookupRegistryMock = vi.fn();

vi.mock("../../lib/sdk", () => ({
  getContractConfig: () => ({ customAccountWasmHash: "wasm-hash" }),
  getKairosClient: () => ({
    ensureFundedTestnetAccount,
    wallet: { prepareSponsoredDeploy },
  }),
  getFunderKeypair: () => ({ publicKey: () => "FUNDER_PUBLIC_KEY" }),
}));

vi.mock("../../lib/sdk/registry", () => ({
  lookupRegistry: lookupRegistryMock,
}));

describe("POST /api/delegate-sdk PREPARE_WALLET_DEPLOY", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the existing smart wallet instead of preparing a new deploy when the owner already has one on-chain", async () => {
    const owner = "GABC_OWNER";
    const existingSmartWallet = "CABC_EXISTING_SMART_WALLET";
    lookupRegistryMock.mockResolvedValueOnce(existingSmartWallet);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/delegate-sdk", {
        method: "POST",
        body: JSON.stringify({ action: "PREPARE_WALLET_DEPLOY", owner }),
      })
    );
    const data = await res.json();

    expect(data).toEqual({
      success: true,
      alreadyExists: true,
      smartWalletAddress: existingSmartWallet,
    });
    // Must never touch the deploy path once an existing wallet is found.
    expect(ensureFundedTestnetAccount).not.toHaveBeenCalled();
    expect(prepareSponsoredDeploy).not.toHaveBeenCalled();
  });

  it("proceeds to prepare a deploy when the registry has no smart wallet for this owner", async () => {
    const owner = "GABC_NEW_OWNER";
    lookupRegistryMock.mockResolvedValueOnce(null);
    prepareSponsoredDeploy.mockResolvedValueOnce({
      unsignedEntryXdr: "xdr",
      saltHex: "salt",
      validUntilLedgerSeq: 100,
    });

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/delegate-sdk", {
        method: "POST",
        body: JSON.stringify({ action: "PREPARE_WALLET_DEPLOY", owner }),
      })
    );
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.alreadyExists).toBeUndefined();
    expect(prepareSponsoredDeploy).toHaveBeenCalledWith("FUNDER_PUBLIC_KEY", owner, "wasm-hash");
  });

  it("P1-3: Registry lookup failure (RPC/timeout/malformed) must never fall through to deploy", async () => {
    // lookupRegistry throws (never returns null) for anything that isn't a confirmed "no
    // wallet" verdict — see packages/sdk/src/registry/index.ts. This route must propagate
    // that failure as an error response, not treat the throw (or any falsy read) as
    // "registry has no wallet" and proceed to deploy a possibly-duplicate smart wallet.
    const owner = "GABC_OWNER";
    lookupRegistryMock.mockRejectedValueOnce(new Error("RPC Error: Registry lookup failed: connection refused"));

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/delegate-sdk", {
        method: "POST",
        body: JSON.stringify({ action: "PREPARE_WALLET_DEPLOY", owner }),
      })
    );
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBeUndefined();
    expect(ensureFundedTestnetAccount).not.toHaveBeenCalled();
    expect(prepareSponsoredDeploy).not.toHaveBeenCalled();
  });
});
