"use client";

import dynamic from "next/dynamic";

// Dynamically import ShaderGradient components with SSR disabled to prevent WebGL/server-side rendering issues
const ShaderGradientCanvas = dynamic(
  () => import("shadergradient").then((mod) => mod.ShaderGradientCanvas),
  { ssr: false }
);
const ShaderGradient = dynamic(
  () => import("shadergradient").then((mod) => mod.ShaderGradient),
  { ssr: false }
);

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-black text-white">
      {/* Background Shader Gradient */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <ShaderGradientCanvas 
          pixelDensity={1}
          fov={45}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
        >
          <ShaderGradient
            animate="on"
            brightness={0.9}
            cAzimuthAngle={180}
            cDistance={3.6}
            cPolarAngle={90}
            cameraZoom={1}
            color1="#7851e9"
            color2="#000000"
            color3="#ffffff"
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

      <div className="relative z-10 text-center">
         
      </div>
    </main>
  );
}