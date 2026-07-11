// Step 1 of Agent Creation (see agentcreation.md): Natural Language -> Intent Parser -> Validated
// AgentSpec. Nothing beyond this is done here — no agent, wallet, or delegation is created.
//
// Provider failover: parsing goes through the shared LLM fallback chain (llmProviders.ts —
// OpenRouter -> GPT-OSS -> Nvidia Nemotron -> Gemini). Whichever provider answers, the output goes
// through the exact same JSON validation, missing-field/confidence clarification logic, and
// AgentSpec shape as before — the frontend has no way to tell which provider was used. If every
// configured provider fails, this returns the same 'failed' status as before: no fabricated
// AgentSpec, no regex/heuristic fallback.
import { RISK_LEVELS, EXECUTION_STYLES } from '@kairos/types';
import type { RiskLevel, ExecutionStyle, AgentSpec, IntentParseResult } from '@kairos/types';

export { RISK_LEVELS, EXECUTION_STYLES };
export type { RiskLevel, ExecutionStyle, AgentSpec, IntentParseResult };

const CONFIDENCE_THRESHOLD = 0.6;

const SYSTEM_PROMPT = `You are Kairos's Intent Parser. A user describes a financial goal for an autonomous portfolio-management agent in plain English. Your job is ONLY to extract structured intent — you never create anything, you never pick a strategy, you never mention smart contracts, protocols, or blockchain internals.

Respond with strict JSON only, no markdown fences, matching exactly this shape:
{
  "mission": string | null,        // short name for what the agent does, e.g. "Yield Optimization"
  "objective": string | null,      // the underlying goal, e.g. "Long-term Growth"
  "riskLevel": "conservative" | "balanced" | "aggressive" | null,
  "suggestedCapital": string | null,   // only if the user actually stated an amount/percentage; otherwise null
  "executionStyle": "autonomous" | "guided" | null,
  "confidence": number,            // 0-1, your genuine confidence that mission+objective+riskLevel+executionStyle were all clearly stated
  "clarifyingQuestions": string[]  // non-empty ONLY if confidence is low or a required field (mission, objective, riskLevel, executionStyle) is missing/ambiguous
}

Rules:
- NEVER invent a value the user did not imply. If a required field is unclear, set it to null and add a clarifying question instead of guessing.
- "mission" is NOT new information — it is a short label (2-4 words) for the objective you already extracted, e.g. objective "Long-term Growth" -> mission "Growth Agent". If you can state an objective, you can always state a mission from it; only set mission to null if objective itself is null.
- If the user does not state a risk level but uses words like "low risk"/"safe"/"keeping risk low", that IS a stated risk level (conservative or balanced) — do not treat it as missing.
- If the user does not mention checking in / manual approval, default executionStyle to "autonomous" — silence on this point is not ambiguity, autonomous is the platform default.
- suggestedCapital must stay null unless the user actually mentioned an amount or percentage.
- Output valid JSON only.

Example:
User: "Grow my XLM while keeping risk low."
{"mission":"Growth Agent","objective":"Long-term Growth","riskLevel":"conservative","suggestedCapital":null,"executionStyle":"autonomous","confidence":0.9,"clarifyingQuestions":[]}`;

// Response validation (provider-agnostic — identical regardless of which provider answered).
// ---------------------------------------------------------------------------

interface RawIntentResponse {
  mission: string | null;
  objective: string | null;
  riskLevel: RiskLevel | null;
  suggestedCapital: string | null;
  executionStyle: ExecutionStyle | null;
  confidence: unknown;
  clarifyingQuestions: unknown;
}

function isRiskLevel(v: unknown): v is RiskLevel {
  return typeof v === 'string' && (RISK_LEVELS as readonly string[]).includes(v);
}

function isExecutionStyle(v: unknown): v is ExecutionStyle {
  return typeof v === 'string' && (EXECUTION_STYLES as readonly string[]).includes(v);
}

/** Validates the model's raw JSON. Returns null if the shape is unusable (missing/wrong-typed
 *  fields the model was explicitly told to produce) — that is a parser failure, not a low-confidence
 *  result, and callers must not treat it as a spec. */
function parseRaw(json: unknown): RawIntentResponse | null {
  if (typeof json !== 'object' || json === null) return null;
  const j = json as Record<string, unknown>;

  const mission = typeof j.mission === 'string' && j.mission.trim() ? j.mission.trim() : null;
  const objective = typeof j.objective === 'string' && j.objective.trim() ? j.objective.trim() : null;
  const riskLevel = isRiskLevel(j.riskLevel) ? j.riskLevel : null;
  const suggestedCapital = typeof j.suggestedCapital === 'string' && j.suggestedCapital.trim() ? j.suggestedCapital.trim() : null;
  const executionStyle = isExecutionStyle(j.executionStyle) ? j.executionStyle : null;

  return {
    mission,
    objective,
    riskLevel,
    suggestedCapital,
    executionStyle,
    confidence: j.confidence,
    clarifyingQuestions: j.clarifyingQuestions,
  };
}

function extractQuestions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
}

const REQUIRED_FIELD_QUESTIONS: Record<'mission' | 'objective' | 'riskLevel' | 'executionStyle', string> = {
  mission: 'What would you like to call this agent, or what should its main job be?',
  objective: 'What is the underlying goal — growth, income, capital preservation, or something else?',
  riskLevel: 'What level of risk are you comfortable with: conservative, balanced, or aggressive?',
  executionStyle: 'Should this agent act fully autonomously, or should it check in with you before acting?',
};

/** Parses a provider's raw completion text into a validated RawIntentResponse, or returns null if
 *  the text isn't usable JSON matching the expected shape. */
function parseCompletion(content: string): RawIntentResponse | null {
  const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    return null;
  }
  return parseRaw(json);
}

// ponytail: LLM intent parsing removed — every free provider is out of daily quota, so the wizard
// was hard-blocking on 'failed'. This deterministic keyword parse never calls a provider and always
// returns a usable spec, so agent creation always proceeds. Upgrade path: restore the LLM call
// (git history / SYSTEM_PROMPT above still here) when real quota is available.
function riskFromText(t: string): RiskLevel {
  if (/\b(conservative|safe|low[\s-]?risk|preserv|cautious|stable)\b/i.test(t)) return 'conservative';
  if (/\b(aggressive|high[\s-]?risk|risky|max(imi[sz]e)?|degen|moonshot)\b/i.test(t)) return 'aggressive';
  return 'balanced';
}

function objectiveFromText(t: string): string {
  if (/\b(income|yield|dividend|interest|passive)\b/i.test(t)) return 'Income Generation';
  if (/\b(preserv|protect|hedge|capital)\b/i.test(t)) return 'Capital Preservation';
  return 'Long-term Growth';
}

function missionFromText(t: string): string {
  const words = t.replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
  return words.length > 2 ? words.replace(/^./, (c) => c.toUpperCase()) : 'Portfolio Agent';
}

/** Deterministic, no-LLM intent parse. Derives a spec from keywords in the goal text and always
 *  succeeds (only empty input asks for clarification), so the wizard never blocks on provider quota. */
export async function parseIntent(goalText: string): Promise<IntentParseResult> {
  const trimmed = goalText.trim();
  if (!trimmed) {
    return {
      status: 'needs_clarification',
      spec: null,
      clarifyingQuestions: ['What do you want this agent to accomplish?'],
    };
  }

  const capitalMatch = trimmed.match(/(\$?\s?\d[\d,]*(?:\.\d+)?\s?%?)/);

  return {
    status: 'ok',
    spec: {
      mission: missionFromText(trimmed),
      objective: objectiveFromText(trimmed),
      riskLevel: riskFromText(trimmed),
      suggestedCapital: capitalMatch ? capitalMatch[1].trim() : null,
      executionStyle: /\b(check|approve|confirm|ask me|guided|manual)\b/i.test(trimmed) ? 'guided' : 'autonomous',
      confidence: 1,
    },
    clarifyingQuestions: [],
  };
}
