import Image from "next/image";
import SubscribeForm from "./components/subscribe-form";

export default function Home() {
  return (
    <div className="min-h-screen bg-[url('/bg.png')] bg-cover bg-center bg-fixed">
      <div className="absolute top-8 left-10 flex items-center gap-1 z-20">
        <div className="relative w-8 h-8 md:w-10 md:h-10">
          <Image
            src="/logo.png"
            alt="Kairos Logo"
            fill
            className="object-contain"
            sizes="(max-width: 768px) 32px, 40px"
          />
        </div>

        <span className="font-inter text-base md:text-lg font-semibold text-white tracking-tight uppercase tracking-wide">
          Kairos
        </span>
      </div>

      <a
        href="https://x.com/KairosProtocoll"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute top-8 right-10 z-20 flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-md transition hover:bg-white/20"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        Follow on X
      </a>

      <div className="flex min-h-screen flex-col items-center justify-center text-center px-6 -translate-y-32">
        <h1 className="font-outfit text-6xl md:text-8xl font-light text-white">
          Join the
        </h1>

        <h2 className="font-outfit text-6xl md:text-8xl italic font-light text-white">
          Agentic Movement
        </h2>

        <p className="mt-6 text-xl text-gray-300">
          Join the waitlist for early access
        </p>

        <SubscribeForm />
      </div>
    </div>
  );
}