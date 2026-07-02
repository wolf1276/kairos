"use client";

import dynamic from "next/dynamic";
import Image from "next/image";

const ShaderGradientCanvas = dynamic(
  () => import("shadergradient").then((mod) => mod.ShaderGradientCanvas),
  { ssr: false }
);
const ShaderGradient = dynamic(
  () => import("shadergradient").then((mod) => mod.ShaderGradient),
  { ssr: false }
);

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

@keyframes drift-purple {
  0% { background-position: 0% 50%; opacity: 0.8; }
  50% { background-position: 14% 50%; opacity: 1; }
  100% { background-position: 0% 50%; opacity: 0.8; }
}
@keyframes breathe-bloom {
  0% { opacity: 0.5; }
  50% { opacity: 1; }
  100% { opacity: 0.5; }
}

.light-drift {
  background: radial-gradient(ellipse 140% 85% at 100% 50%, rgba(120, 81, 233, 0.10), transparent 55%);
  background-size: 160% 100%;
  animation: drift-purple 50s ease-in-out infinite;
}
.bloom-breathe {
  background: radial-gradient(ellipse 45% 25% at 50% 42%, rgba(255, 255, 255, 0.012), transparent 65%);
  animation: breathe-bloom 25s ease-in-out infinite;
}

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
 
      {/* ── Purple dynamic blend fading from left to right ── */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none">
        <div className="absolute inset-0">
          <ShaderGradientCanvas
            pixelDensity={1}
            fov={45}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
          >
            <ShaderGradient
              animate="on"
              brightness={0.45}
              cAzimuthAngle={180}
              cDistance={3.6}
              cPolarAngle={90}
              cameraZoom={1}
              color1="#7851e9"
              color2="#000000"
              color3="#000000"
              envPreset="city"
              grain="on"
              lightType="env"
              positionX={-1.4}
              positionY={0}
              positionZ={0}
              reflection={0.1}
              rotationX={0}
              rotationY={10}
              rotationZ={50}
              shader="defaults"
              type="plane"
              uAmplitude={1}
              uDensity={1.3}
              uFrequency={5.5}
              uSpeed={0.2}
              uStrength={4}
              uTime={0}
              wireframe={false}
            />
          </ShaderGradientCanvas>
        </div>
        <div className="absolute inset-0 light-drift opacity-80" />
        <div className="absolute inset-0 bloom-breathe opacity-50" />
        {/* Soft shadow mask — left side readable, right side reveals shader */}
        <div 
          className="absolute inset-0" 
          style={{
            background: "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.25) 30%, rgba(0,0,0,0.15) 60%, transparent 80%, transparent 100%)"
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

      <nav className="relative z-20 flex items-center justify-between px-6 py-6 md:px-12 md:py-9 lg:px-20">
        <div className="flex items-center gap-5">
          <Image
            src="/logo.png"
            alt="Kairos"
            width={42}
            height={42}
            className="opacity-80"
          />
          <span className="text-base md:text-lg font-medium tracking-[0.35em] uppercase text-white/90">
            KAIROS
          </span>
        </div>
        <div className="flex items-center gap-9">
          <a href="/docs" className="text-sm md:text-base text-white/70 transition duration-500 hover:text-white">Docs</a>
          <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-sm md:text-base text-white/70 transition duration-500 hover:text-white">GitHub</a>
          <a href="https://x.com/KairosProtocoll" target="_blank" rel="noopener noreferrer" className="text-sm md:text-base text-white/70 transition duration-500 hover:text-white">Twitter</a>
        </div>
      </nav>

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
            <button className="h-10 rounded-full border border-white/10 bg-white/[0.02] px-6 text-[10px] font-semibold text-white/80 transition duration-500 hover:bg-white/[0.06] hover:border-white/20">
              Documentation
            </button>
          </div>


        </div>


      </div>
    </main>
  );
}
