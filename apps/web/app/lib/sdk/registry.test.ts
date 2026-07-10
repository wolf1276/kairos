import { describe, expect, it, vi, beforeEach } from "vitest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

const OWNER = Keypair.random().publicKey();
const OTHER_OWNER = Keypair.random().publicKey();
const SMART_WALLET = StrKey.encodeContract(Buffer.alloc(32, 1));

// Regression tests for registerOnChain's ownership guard (P1-1). The Registry contract is
// funder-attested and does not prove ownership itself, and /api/connect/register forwards a
// client-supplied smartWallet. This guard reads the wallet's on-chain Owner and refuses to
// attest a wallet the claimed owner doesn't actually control.

const ownerFn = vi.fn();
const registerFn = vi.fn();
const ensureFundedFn = vi.fn();

vi.mock("./client", () => ({
  getContractConfig: () => ({ registry: "REGISTRY_CONTRACT_ID" }),
  getKairosClient: () => ({
    wallet: { owner: ownerFn },
    registry: { register: registerFn },
    ensureFundedTestnetAccount: ensureFundedFn,
  }),
}));

vi.mock("./wallet/accounts", () => ({
  getFunderKeypair: () => Keypair.random(),
}));

describe("registerOnChain ownership guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureFundedFn.mockResolvedValue(undefined);
    registerFn.mockResolvedValue(undefined);
  });

  it("valid registration: wallet Owner matches -> registers", async () => {
    ownerFn.mockResolvedValueOnce(OWNER);
    const { registerOnChain } = await import("./registry");

    await registerOnChain(OWNER, SMART_WALLET);

    expect(ownerFn).toHaveBeenCalledWith(SMART_WALLET);
    expect(registerFn).toHaveBeenCalledWith(expect.anything(), OWNER, SMART_WALLET);
  });

  it("ownership mismatch: wallet Owner != claimed owner -> throws, never registers", async () => {
    ownerFn.mockResolvedValueOnce(OTHER_OWNER);
    const { registerOnChain } = await import("./registry");

    await expect(registerOnChain(OWNER, SMART_WALLET)).rejects.toThrow(/Ownership mismatch/);
    expect(registerFn).not.toHaveBeenCalled();
  });
});
