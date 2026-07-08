import { describe, expect, it, vi, beforeEach } from "vitest";

// Regression test for the Create Agent wizard's Step 1 -> Step 2 transition
// (Describe Goal -> AI Understanding, agentcreation.md). The wizard posts to this exact
// route (AgentCreationWizard.tsx: fetch("/api/intent/parse")) — it must never 404 or 500
// for a well-formed goal, and must fall back to the regex parser when the HF-based parser
// is unavailable/incomplete instead of surfacing an error.

const parseIntentWithHf = vi.fn();

vi.mock("@/lib/decision/hfIntentParser", () => ({ parseIntentWithHf }));

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/intent/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/intent/parse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with a READY status when the HF parser completes", async () => {
    parseIntentWithHf.mockResolvedValueOnce({
      status: "COMPLETE",
      profile: { goal: "Grow my XLM", riskTolerance: "LOW", investmentHorizon: "LONG" },
    });

    const { POST } = await import("./route");
    const res = await POST(req({ text: "Grow my XLM over the long term while keeping risk low." }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("READY");
    expect(data.profile).toBeTruthy();
  });

  it("falls back to the regex parser (still 200, not a 404/500) when HF is unavailable", async () => {
    parseIntentWithHf.mockResolvedValueOnce({ status: "FAILED", profile: null });

    const { POST } = await import("./route");
    const res = await POST(req({ text: "Grow my XLM over the long term while keeping risk low." }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(["READY", "MORE_INFORMATION_REQUIRED"]).toContain(data.status);
  });

  it("rejects a missing goal with 400, not a 404", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({}));

    expect(res.status).toBe(400);
  });
});
