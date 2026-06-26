"use client";

import { useState } from "react";

export default function SubscribeForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;

    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "Something went wrong");
        return;
      }

      setStatus("success");
      setMessage("Access reserved. We'll be in touch soon.");
      setEmail("");
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  return (
    <div className="mt-10 flex w-full max-w-xl flex-col items-center gap-4">
      <form onSubmit={handleSubmit} className="flex w-full gap-4">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          required
          disabled={status === "loading"}
          className="flex-1 rounded-full border border-white/20 bg-white/10 px-6 py-4 text-white placeholder:text-gray-400 backdrop-blur-md outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded-full bg-[#7C4DFF] px-8 py-4 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {status === "loading" ? "Sending…" : "Join"}
        </button>
      </form>
      {message && (
        <p
          className={`text-sm ${
            status === "success" ? "text-purple-400" : "text-red-400"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
