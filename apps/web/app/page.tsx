"use client";

const GRAIN = `data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.5'/%3E%3C/svg%3E`;

const styles = `
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}
.anim-eyebrow { animation: fadeUp 0.9s cubic-bezier(0.16, 1, 0.3, 1) both; }
.anim-headline { animation: fadeUp 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.12s both; }
.anim-sub { animation: fadeUp 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.24s both; }
.anim-cta { animation: fadeUp 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.36s both; }
.anim-pill-1 { animation: fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.5s both; }
.anim-pill-2 { animation: fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.6s both; }
.anim-pill-3 { animation: fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.7s both; }

.hero-text {
  transform-origin: left center;
  transform: scale(1);
}
@media (min-width: 768px) {
  .hero-text { transform: scale(1.3); }
}
@media (min-width: 1024px) {
  .hero-text { transform: scale(1.6); }
}
@media (min-width: 1280px) {
  .hero-text { transform: scale(2); }
}
`;

export default function Home() {

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-black text-white">
      <style>{styles}</style>
 
      {/* ── Background grid ── */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)
            `,
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(circle at center, black 70%, transparent 100%)",
            WebkitMaskImage:
              "radial-gradient(circle at center, black 70%, transparent 100%)",
          }}
        />
      </div>

      {/* ── Film grain overlay ── */}
      <div
        className="absolute inset-0 z-[2] pointer-events-none opacity-[0.015]"
        style={{
          backgroundImage: `url("${GRAIN}")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
          mixBlendMode: "overlay",
        }}
      />

      <div className="pt-16" />

      {/* ── Editorial hero ── */}
      <div className="relative z-10 flex-1 grid grid-cols-12 items-center px-6 md:px-10 lg:px-16 overflow-visible">
        {/* Text content */}
        <div className="col-span-12 md:col-span-8 lg:col-span-7 pt-8 md:pt-0 text-left hero-text">
          <h1 className="anim-title text-5xl font-normal tracking-tight text-white sm:text-6xl md:text-7xl">
            Programmable <br />
            <span className="font-serif italic font-light text-white/90">Capital.</span>
          </h1>
          <p className="anim-desc mt-6 text-sm leading-relaxed text-white/55">
            Delegate authority—not ownership. Every execution is governed by programmable policies and verified on-chain.
          </p>

          <div className="anim-cta mt-10 flex flex-wrap gap-4">
            <a
              href="/dashboard"
              className="inline-flex h-10 items-center rounded-full bg-white px-6 text-[10px] font-semibold text-black transition duration-500 hover:bg-white/90"
            >
              Launch App
            </a>
            <a
              href="/docs"
              className="inline-flex h-10 items-center rounded-full border border-white/10 bg-white/[0.02] px-6 text-[10px] font-semibold text-white/80 transition duration-500 hover:bg-white/[0.06] hover:border-white/20"
            >
              Documentation
            </a>
          </div>


        </div>


      </div>
    </main>
  );
}
