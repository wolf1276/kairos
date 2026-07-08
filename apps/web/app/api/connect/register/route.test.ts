import { describe, expect, it, vi, beforeEach } from "vitest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

const OWNER = Keypair.random().publicKey();
const SMART_WALLET = StrKey.encodeContract(Buffer.alloc(32, 1));

// Regression tests for /api/connect/register — the retry-only path used when a prior
// /api/connect/submit's registry write failed. Same invariant as submit's: registry write must
// be verified before the request can report success; a fire-and-forget write here would leave
// /api/connect/check's fallback pointing nowhere while the caller thinks it worked.

const registerOnChain = vi.fn();
const lookupRegistry = vi.fn();
const backendFetchMock = vi.fn();

vi.mock("@/app/lib/sdk", () => ({
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
  return new Request("http://localhost/api/connect/register", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/connect/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("DB saved -> Registry verified -> success", async () => {
    backendFetchMock.mockResolvedValueOnce({ ok: true, status: 200, data: { owner: OWNER } });
    registerOnChain.mockResolvedValueOnce(undefined);
    lookupRegistry.mockResolvedValueOnce(SMART_WALLET);

    const { POST } = await import("./route");
    const res = await POST(req({ smartWallet: SMART_WALLET }));
    const data = await res.json();

    expect(registerOnChain).toHaveBeenCalledWith(OWNER, SMART_WALLET);
    expect(lookupRegistry).toHaveBeenCalledWith(OWNER);
    expect(data).toEqual({ success: true, status: "created", smartWallet: SMART_WALLET });
  });

  it("Registry write failure -> request fails -> no false success", async () => {
    backendFetchMock.mockResolvedValueOnce({ ok: true, status: 200, data: { owner: OWNER } });
    registerOnChain.mockRejectedValueOnce(new Error("registry tx failed"));

    const { POST } = await import("./route");
    const res = await POST(req({ smartWallet: SMART_WALLET }));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.success).toBeUndefined();
    expect(data.smartWallet).toBe(SMART_WALLET);
  });

  it("Registry verification mismatch -> request fails -> no false success", async () => {
    backendFetchMock.mockResolvedValueOnce({ ok: true, status: 200, data: { owner: OWNER } });
    registerOnChain.mockResolvedValueOnce(undefined);
    lookupRegistry.mockResolvedValueOnce(null);

    const { POST } = await import("./route");
    const res = await POST(req({ smartWallet: SMART_WALLET }));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.success).toBeUndefined();
  });

  it("DB persistence failure -> request fails before touching registry", async () => {
    backendFetchMock.mockResolvedValueOnce({ ok: false, status: 503, data: { error: "db unreachable" } });

    const { POST } = await import("./route");
    const res = await POST(req({ smartWallet: SMART_WALLET }));
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toBe("db unreachable");
    expect(registerOnChain).not.toHaveBeenCalled();
  });
});
