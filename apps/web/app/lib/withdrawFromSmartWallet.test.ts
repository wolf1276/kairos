import { describe, expect, it, vi, beforeEach } from "vitest";
import { Keypair, Account, StrKey, SorobanDataBuilder, xdr } from "@stellar/stellar-sdk";

const kp = Keypair.random();
const smartWalletAddress = StrKey.encodeContract(Buffer.alloc(32, 7));

function fakeSorobanData() {
  return new SorobanDataBuilder();
}

function fakeSimResult() {
  return xdr.ScVal.scvVoid();
}

vi.mock("@/app/lib/walletKit", () => ({
  kitGetAddress: vi.fn(async () => kp.publicKey()),
  kitGetNetwork: vi.fn(),
  kitSignTransaction: vi.fn(async (xdr: string) => xdr),
  kitSignAuthEntry: vi.fn(),
  kitSignMessage: vi.fn(),
  kitDisconnect: vi.fn(),
}));

const getAccount = vi.fn(async () => new Account(kp.publicKey(), "1"));
const simulateTransaction = vi.fn();
const sendTransaction = vi.fn();
const getTransaction = vi.fn();

vi.mock("@stellar/stellar-sdk", async () => {
  const actual = await vi.importActual<typeof import("@stellar/stellar-sdk")>("@stellar/stellar-sdk");
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getAccount,
        simulateTransaction,
        sendTransaction,
        getTransaction,
      })),
    },
  };
});

import { withdrawFromSmartWallet } from "./stellar";

describe("withdrawFromSmartWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccount.mockImplementation(async () => new Account(kp.publicKey(), "1"));
  });

  it("restores archived ledger entries before submitting instead of sending a doomed tx", async () => {
    // Regression: simulateTransaction reports "success" (transactionData present) even when the
    // simulated footprint needs restoring — `isSimulationSuccess` doesn't distinguish that case.
    // Submitting straight off that simulation used to fail on-chain with an archived-entry error.
    simulateTransaction
      .mockResolvedValueOnce({
        _parsed: true, transactionData: fakeSorobanData(),
        restorePreamble: { transactionData: new SorobanDataBuilder(), minResourceFee: "100" },
      })
      .mockResolvedValueOnce({
        _parsed: true, transactionData: fakeSorobanData(),
        minResourceFee: "100",
        result: { auth: [], retval: fakeSimResult() },
      });
    sendTransaction
      .mockResolvedValueOnce({ status: "PENDING", hash: "restore-hash" })
      .mockResolvedValueOnce({ status: "PENDING", hash: "withdraw-hash" });
    getTransaction
      .mockResolvedValueOnce({ status: "SUCCESS" })
      .mockResolvedValueOnce({ status: "SUCCESS" });

    const result = await withdrawFromSmartWallet(smartWalletAddress, "5", actualNetworkPassphrase());

    expect(simulateTransaction).toHaveBeenCalledTimes(2);
    expect(sendTransaction).toHaveBeenCalledTimes(2);
    expect(result.hash).toBe("withdraw-hash");
  });

  it("submits directly when no restore is needed", async () => {
    simulateTransaction.mockResolvedValueOnce({
      _parsed: true, transactionData: fakeSorobanData(),
      minResourceFee: "100",
      result: { auth: [], retval: fakeSimResult() },
    });
    sendTransaction.mockResolvedValueOnce({ status: "PENDING", hash: "withdraw-hash" });
    getTransaction.mockResolvedValueOnce({ status: "SUCCESS" });

    const result = await withdrawFromSmartWallet(smartWalletAddress, "5", actualNetworkPassphrase());

    expect(simulateTransaction).toHaveBeenCalledTimes(1);
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(result.hash).toBe("withdraw-hash");
  });
});

function actualNetworkPassphrase(): string {
  return "Test SDF Network ; September 2015";
}
