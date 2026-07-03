"use client";

import Link from "next/link";
import { Card, CardBody } from "@/app/components/ui/Card";

export default function PortfolioPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-lg font-medium text-text-primary">Portfolio</h1>
        <p className="mt-1 text-sm text-text-muted">
          Real portfolio tracking coming soon with on-chain Stellar testnet trading.
        </p>
      </div>

      <Card>
        <CardBody className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-elevated/50">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <h2 className="font-display text-base font-medium text-text-primary">No trades yet</h2>
          <p className="mt-2 max-w-sm text-sm text-text-muted">
            Connect Freighter and start trading XLM/USDC on Stellar testnet to see your portfolio.
          </p>
          <Link
            href="/dashboard/trade"
            className="mt-6 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            Start Trading
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
