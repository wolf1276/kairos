import Link from "next/link";
import Image from "next/image";

const STEPS = [
  {
    title: "Connect Freighter",
    body: "Install the Freighter wallet extension and connect it from the Delegations page. This is the wallet that will own any smart wallet you deploy.",
  },
  {
    title: "Deploy a smart wallet",
    body: "A Smart Wallet is a Soroban contract account. Deploying one is sponsored — the funder pays fees, you just authorize it with Freighter.",
  },
  {
    title: "Create a delegation",
    body: "Sign an off-chain delegation that authorizes your smart wallet to act within policies you set: a target whitelist, a spend limit, or a time window.",
  },
  {
    title: "Trade",
    body: "The Manual mode on the Trade page places real paper trades against live market prices. Strategy, Intent, and Agent Auto are early previews — nothing executes yet.",
  },
];

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <nav className="flex items-center justify-between px-6 py-6 md:px-12 md:py-9 lg:px-20">
        <Link href="/" className="flex items-center gap-5">
          <Image src="/logo.png" alt="Kairos" width={36} height={36} className="opacity-80" />
          <span className="text-base font-medium tracking-[0.35em] uppercase text-white/90">
            KAIROS
          </span>
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex h-9 items-center rounded-full bg-white px-5 text-[10px] font-semibold text-black transition duration-500 hover:bg-white/90"
        >
          Launch App
        </Link>
      </nav>

      <div className="mx-auto max-w-2xl px-6 pb-24 pt-8 md:px-0">
        <h1 className="text-4xl font-normal tracking-tight text-white sm:text-5xl">
          Getting started
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-white/55">
          Kairos lets you delegate authority over capital&mdash;not ownership&mdash;to policies
          and agents that execute within limits you define, verified on-chain via Soroban smart
          contracts on Stellar.
        </p>

        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-3.5 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span className="text-[11px] font-medium text-amber-300/90">
            Testnet only &mdash; portfolio values and trades are simulated, not real funds
          </span>
        </div>

        <ol className="mt-10 space-y-6">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] font-mono text-xs text-white/70">
                {i + 1}
              </span>
              <div>
                <h2 className="text-sm font-medium text-white">{step.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-white/55">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/dashboard/delegations"
            className="inline-flex h-10 items-center rounded-full bg-white px-6 text-[10px] font-semibold text-black transition duration-500 hover:bg-white/90"
          >
            Start with Delegations
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center rounded-full border border-white/10 bg-white/[0.02] px-6 text-[10px] font-semibold text-white/80 transition duration-500 hover:bg-white/[0.06] hover:border-white/20"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
