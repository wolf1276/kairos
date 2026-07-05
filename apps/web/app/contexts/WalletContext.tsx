"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSmartWallet, type SmartWalletState } from "@/app/hooks/useSmartWallet";
import { ConnectWalletModal } from "@/components/ConnectWalletModal";

const WalletContext = createContext<SmartWalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useSmartWallet();
  return (
    <WalletContext.Provider value={wallet}>
      {children}
      <ConnectWalletModal
        open={wallet.walletModalOpen}
        connecting={wallet.connecting}
        error={wallet.walletPickError}
        onClose={wallet.closeWalletModal}
        onPick={wallet.pickWallet}
      />
    </WalletContext.Provider>
  );
}

export function useWalletContext(): SmartWalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWalletContext must be used within <WalletProvider>");
  return ctx;
}
