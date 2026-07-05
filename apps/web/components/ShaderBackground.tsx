"use client";

import dynamic from "next/dynamic";

const GrainGradient = dynamic(
  () =>
    import("@paper-design/shaders-react").then((mod) => mod.GrainGradient),
  { ssr: false }
);

const GRAIN = `data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.5'/%3E%3C/svg%3E`;

export function ShaderBackground() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none select-none overflow-hidden">
      <GrainGradient
        colorBack="#0a0a0c"
        colors={["#121214", "#18181b", "#0a0a0c"]}
        speed={0.08}
        intensity={0.1}
        noise={0.15}
        softness={0.3}
        shape="corners"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `url("${GRAIN}")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
          mixBlendMode: "overlay",
        }}
      />
    </div>
  );
}
