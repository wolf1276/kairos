import { describe, expect, it, vi, beforeEach } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

const OWNER = Keypair.random().publicKey();

// Regression tests for login-time recovery: existing Smart Wallets must always be found again —
// from the DB fast path, or from the on-chain registry (with DB backfill) when the DB row is
// gone — and a "new" verdict must only ever be reached once both have been checked.

const lookupRegistry = vi.fn();
const backendFetchMock = vi.fn();
const registerSmartWalletMock = vi.fn();

vi.mock("@/app/lib/sdk/registry", () => ({ lookupRegistry }));

vi.mock("../_shared", async () => {
  const actual = await vi.importActual<typeof import("../_shared")>("../_shared");
  return {
    ...actual,
    backendFetch: backendFetchMock,
    registerSmartWallet: registerSmartWalletMock,
  };
});

function req() {
  return new Request("http://localhost/api/connect/check", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
  });
}

describe("POST /api/connect/check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Logout -> Login -> Wallet restored (DB fast path)", async () => {
    backendFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { owner: OWNER, wallets: [{ owner: OWNER, address: "CSMART_WALLET" }] },
    });

    const { POST } = await import("./route");
    const res = await POST(req());
    const data = await res.json();

    expect(data).toEqual({ success: true, status: "existing", walletAddress: OWNER, smartWallet: "CSMART_WALLET" });
    expect(lookupRegistry).not.toHaveBeenCalled();
  });

  it("Delete local DB entry -> Login -> Registry restores DB", async () => {
    backendFetchMock.mockResolvedValueOnce({ ok: true, status: 200, data: { owner: OWNER, wallets: [] } });
    lookupRegistry.mockResolvedValueOnce("CSMART_WALLET");
    registerSmartWalletMock.mockResolvedValueOnce({ ok: true, status: 200, data: {} });

    const { POST } = await import("./route");
    const res = await POST(req());
    const data = await res.json();

    expect(lookupRegistry).toHaveBeenCalledWith(OWNER);
    // DB mapping must be backfilled, not just returned transiently.
    expect(registerSmartWalletMock).toHaveBeenCalledWith("Bearer test-token", "CSMART_WALLET");
    expect(data).toEqual({ success: true, status: "existing", walletAddress: OWNER, smartWallet: "CSMART_WALLET" });
  });

  it("fresh user: DB empty and registry empty -> new (creation allowed)", async () => {
    backendFetchMock.mockResolvedValueOnce({ ok: true, status: 200, data: { owner: OWNER, wallets: [] } });
    lookupRegistry.mockResolvedValueOnce(null);

    const { POST } = await import("./route");
    const res = await POST(req());
    const data = await res.json();

    expect(data).toEqual({ success: true, status: "new" });
    expect(registerSmartWalletMock).not.toHaveBeenCalled();
  });

  it("DB unavailable (503) -> Registry consulted, not short-circuited", async () => {
    backendFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      data: { error: "Failed to read smart wallets: connection timeout", owner: OWNER },
    });
    lookupRegistry.mockResolvedValueOnce("CSMART_WALLET");
    registerSmartWalletMock.mockResolvedValueOnce({ ok: true, status: 200, data: {} });

    const { POST } = await import("./route");
    const res = await POST(req());
    const data = await res.json();

    expect(lookupRegistry).toHaveBeenCalledWith(OWNER);
    expect(data).toEqual({ success: true, status: "existing", walletAddress: OWNER, smartWallet: "CSMART_WALLET" });
  });

  it("DB unavailable + Registry empty -> new, DB error surfaced but not blocking", async () => {
    backendFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      data: { error: "Failed to read smart wallets: connection timeout", owner: OWNER },
    });
    lookupRegistry.mockResolvedValueOnce(null);

    const { POST } = await import("./route");
    const res = await POST(req());
    const data = await res.json();

    expect(data).toEqual({
      success: true,
      status: "new",
      dbWarning: "Failed to read smart wallets: connection timeout",
    });
    expect(registerSmartWalletMock).not.toHaveBeenCalled();
  });

  it("DB unavailable + Registry wallet -> existing, backfill attempted best-effort", async () => {
    backendFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      data: { error: "Failed to read smart wallets: connection timeout", owner: OWNER },
    });
    lookupRegistry.mockResolvedValueOnce("CSMART_WALLET");
    registerSmartWalletMock.mockResolvedValueOnce({ ok: false, status: 503, data: { error: "still down" } });

    const { POST } = await import("./route");
    const res = await POST(req());
    const data = await res.json();

    // Backfill failure must not surface as an error or block the "existing" verdict.
    expect(registerSmartWalletMock).toHaveBeenCalledWith("Bearer test-token", "CSMART_WALLET");
    expect(data).toEqual({ success: true, status: "existing", walletAddress: OWNER, smartWallet: "CSMART_WALLET" });
  });

  it("Registry lookup throws (RPC/network/simulation/timeout) -> explicit error, never 'new'", async () => {
    backendFetchMock.mockResolvedValueOnce({ ok: true, status: 200, data: { owner: OWNER, wallets: [] } });
    lookupRegistry.mockRejectedValueOnce(new Error("Registry lookup failed: connection refused"));

    const { POST } = await import("./route");
    const res = await POST(req());
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data).toEqual({
      success: false,
      status: "error",
      error: "Registry lookup failed: Registry lookup failed: connection refused",
    });
    expect(registerSmartWalletMock).not.toHaveBeenCalled();
  });

  it("DB unavailable AND Registry lookup throws -> explicit error, never falls open to 'new'", async () => {
    backendFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      data: { error: "Failed to read smart wallets: connection timeout", owner: OWNER },
    });
    lookupRegistry.mockRejectedValueOnce(new Error("Transaction simulation failed: HostError"));

    const { POST } = await import("./route");
    const res = await POST(req());
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.status).toBe("error");
    expect(data.status).not.toBe("new");
    expect(registerSmartWalletMock).not.toHaveBeenCalled();
  });

  it("DB unavailable + backfill call itself throws -> still reports existing wallet", async () => {
    backendFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      data: { error: "Failed to read smart wallets: connection timeout", owner: OWNER },
    });
    lookupRegistry.mockResolvedValueOnce("CSMART_WALLET");
    registerSmartWalletMock.mockRejectedValueOnce(new Error("network down"));

    const { POST } = await import("./route");
    const res = await POST(req());
    const data = await res.json();

    expect(data).toEqual({ success: true, status: "existing", walletAddress: OWNER, smartWallet: "CSMART_WALLET" });
  });
});
