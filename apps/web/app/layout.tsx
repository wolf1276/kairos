import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "PaperTrade Agent — Stellar",
  description:
    "Connect your Freighter wallet, delegate testnet funds, and let the AI agent trade for you on Stellar.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("h-full", "font-sans", geist.variable)}>
      <head>
        {/* Suppress Next.js dev overlay triggers for external browser extensions (e.g., MetaMask connection failures) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.addEventListener('error', (event) => {
                if (event.filename && (event.filename.includes('chrome-extension://') || event.filename.includes('metamask'))) {
                  event.stopImmediatePropagation();
                }
              }, true);
              window.addEventListener('unhandledrejection', (event) => {
                const stack = event.reason?.stack || '';
                const msg = event.reason?.message || '';
                if (stack.includes('chrome-extension://') || stack.includes('metamask') || msg.includes('MetaMask') || msg.includes('connect')) {
                  event.stopImmediatePropagation();
                  event.preventDefault();
                }
              }, true);
            `,
          }}
        />
      </head>
      <body className="min-h-full bg-bg-primary text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
