import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import Script from "next/script";
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
        <Script
          id="suppress-extension-errors"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              window.addEventListener('error', function(e) {
                if (e.filename && (e.filename.includes('chrome-extension://') || e.filename.includes('metamask'))) {
                  e.stopImmediatePropagation();
                }
              }, true);
              window.addEventListener('unhandledrejection', function(e) {
                var stack = e.reason && e.reason.stack || '';
                var msg = e.reason && e.reason.message || '';
                if (stack.includes('chrome-extension://') || stack.includes('metamask') || msg.includes('MetaMask') || msg.includes('connect')) {
                  e.stopImmediatePropagation();
                  e.preventDefault();
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
