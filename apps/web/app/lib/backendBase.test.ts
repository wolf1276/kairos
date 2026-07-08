import { describe, expect, it } from "vitest";
import { resolveAgentsBackendBase } from "./backendBase";

describe("resolveAgentsBackendBase", () => {
  it("uses the configured env var when set", () => {
    expect(resolveAgentsBackendBase("https://backend.example.com", "app.example.com")).toBe(
      "https://backend.example.com"
    );
  });

  it("falls back to localhost:4001 in local dev (no hostname / localhost / 127.0.0.1)", () => {
    expect(resolveAgentsBackendBase(undefined, undefined)).toBe("http://localhost:4001");
    expect(resolveAgentsBackendBase(undefined, "localhost")).toBe("http://localhost:4001");
    expect(resolveAgentsBackendBase(undefined, "127.0.0.1")).toBe("http://localhost:4001");
  });

  it("throws instead of silently defaulting to localhost on a real deployed hostname", () => {
    // Regression: NEXT_PUBLIC_AGENTS_BACKEND_URL is inlined at build time. A production build
    // missing it used to silently resolve to "http://localhost:4001" in every visitor's
    // browser — unreachable there — breaking wallet-login/lookup/creation with no diagnosable
    // error. It must now fail loudly instead.
    expect(() => resolveAgentsBackendBase(undefined, "kairos.app")).toThrow(
      /NEXT_PUBLIC_AGENTS_BACKEND_URL/
    );
  });
});
