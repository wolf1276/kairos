"use client";

import Link from "next/link";
import { Card, CardBody } from "@/app/components/ui/Card";

export default function HistoryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-lg font-medium text-text-primary">Trade History</h1>
        <p className="mt-1 text-sm text-text-muted">
          On-chain trade history from Stellar testnet executions.
        </p>
      </div>

      <Card>
        <CardBody className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-elevated/50">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h2 className="font-display text-base font-medium text-text-primary">No history yet</h2>
          <p className="mt-2 max-w-sm text-sm text-text-muted">
            Execute your first trade on Stellar testnet and it will appear here.
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
