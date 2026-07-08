import { describe, expect, it, vi, beforeEach } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

const OWNER = Keypair.random().publicKey();

// Regression tests for the P0 creation-flow invariant: a create must register + VERIFY the
// on-chain registry entry before it can report success. A silent/failed registry write must
// never be reported as success (it's the only durable fallback /api/connect/check has once the
// DB row is lost), and must never leave the caller thinking the wallet is unusable.

const submitSmartWalletDeploy = vi.fn();
const registerOnChain = vi.fn();
const lookupRegistry = vi.fn();
const backendFetchMock = vi.fn();

vi.mock("@/app/lib/sdk", () => ({
  submitSmartWalletDeploy,
  getContractConfig: () => ({ registry: "REGISTRY_CONTRACT_ID" }),
}));

vi.mock("@/app/lib/sdk/registry", () => ({
  registerOnChain,
  lookupRegistry,
}));

vi.mock("../_shared", async () => {
  const actual = await vi.importActual<typeof import("../_shared")>("../_shared");
  return {
    ...actual,
    backendFetch: backendFetchMock,
    registerSmartWallet: (authHeader: string, address: string) =>
      backendFetchMock("/api/smart-wallets", authHeader, { method: "POST", body: JSON.stringify({ address }) }),
  };
});

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/connect/submit", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/connect/submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submitSmartWalletDeploy.mockResolvedValue({ address: "CSMART_WALLET" });
  });

  it("Create Wallet -> Registry updated -> DB updated", async () => {
    registerOnChain.mockResolvedValueOnce(undefined);
    lookupRegistry.mockResolvedValueOnce("CSMART_WALLET");
    backendFetchMock.mockResolvedValueOnce({ ok: true, status: 200, data: { owner: OWNER } });

    const { POST } = await import("./route");
    const res = await POST(req({ owner: OWNER, saltHex: "salt", signedEntryXdr: "xdr" }));
    const data = await res.json();

    expect(registerOnChain).toHaveBeenCalledWith(OWNER, "CSMART_WALLET");
    expect(lookupRegistry).toHaveBeenCalledWith(OWNER);
    expect(backendFetchMock).toHaveBeenCalled(); // DB persist
    expect(data).toEqual({ success: true, status: "created", walletAddress: OWNER, smartWallet: "CSMART_WALLET" });
  });

  it("Registry write failure -> Creation fails -> No false success", async () => {
    registerOnChain.mockRejectedValueOnce(new Error("registry tx failed"));

    const { POST } = await import("./route");
    const res = await POST(req({ owner: OWNER, saltHex: "salt", signedEntryXdr: "xdr" }));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.success).toBeUndefined();
    expect(data.smartWallet).toBe("CSMART_WALLET");
    // DB must never be persisted off an unverified registry write.
    expect(backendFetchMock).not.toHaveBeenCalled();
  });

  it("Registry verification mismatch -> Creation fails -> No false success", async () => {
    registerOnChain.mockResolvedValueOnce(undefined);
    lookupRegistry.mockResolvedValueOnce(null); // write "succeeded" but entry isn't actually readable back

    const { POST } = await import("./route");
    const res = await POST(req({ owner: OWNER, saltHex: "salt", signedEntryXdr: "xdr" }));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.success).toBeUndefined();
    expect(backendFetchMock).not.toHaveBeenCalled();
  });
});
