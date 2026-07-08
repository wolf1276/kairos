// Step 1 of Agent Creation (see agentcreation.md): Natural Language -> Hugging Face Intent
// Parser -> Validated AgentSpec. Nothing beyond this is done here — no agent, wallet, or
// delegation is created. Mirrors the HF wiring already used in decisionEngine.ts (same
// HUGGINGFACE_API_KEY, same @huggingface/inference client), but this parser has no heuristic
// fallback: unlike trading decisions, a fabricated AgentSpec would misrepresent user intent, so
// when HF is unavailable or the parse fails, callers get a clear failure instead of an invented spec.
import { HfInference } from '@huggingface/inference';
import { getHuggingFaceApiKey } from './config.js';
import { RISK_LEVELS, EXECUTION_STYLES } from '@kairos/types';
import type { RiskLevel, ExecutionStyle, AgentSpec, IntentParseResult } from '@kairos/types';

export { RISK_LEVELS, EXECUTION_STYLES };
export type { RiskLevel, ExecutionStyle, AgentSpec, IntentParseResult };

const MODEL = 'meta-llama/Llama-3.1-8B-Instruct';
const MAX_RETRIES = 2;
const BACKOFF_MS = 1500;

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

function hf(): HfInference | null {
  const key = getHuggingFaceApiKey();
  return key ? new HfInference(key) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

/** Runs the natural-language goal through the Hugging Face intent parser and returns a
 *  validated AgentSpec, or a request for clarification. Never fabricates a missing field. */
export async function parseIntent(goalText: string): Promise<IntentParseResult> {
  const trimmed = goalText.trim();
  if (!trimmed) {
    return {
      status: 'needs_clarification',
      spec: null,
      clarifyingQuestions: ['What do you want this agent to accomplish?'],
    };
  }

  const client = hf();
  if (!client) {
    return {
      status: 'failed',
      spec: null,
      clarifyingQuestions: [],
      error: 'Hugging Face is not configured (HUGGINGFACE_API_KEY unset). Cannot parse intent.',
    };
  }

  let lastError = '';
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS * attempt);
    try {
      const res = await client.chatCompletion({
        model: MODEL,
        max_tokens: 500,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: trimmed },
        ],
      });
      const content = res.choices?.[0]?.message?.content;
      if (!content) {
        lastError = 'empty response from Hugging Face';
        continue;
      }
      const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      let json: unknown;
      try {
        json = JSON.parse(cleaned);
      } catch {
        lastError = 'model response was not valid JSON';
        continue;
      }
      const raw = parseRaw(json);
      if (!raw) {
        lastError = 'model response did not match the expected AgentSpec shape';
        continue;
      }

      const confidence = typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : 0;
      const questions = extractQuestions(raw.clarifyingQuestions);

      const missing: string[] = [];
      if (!raw.mission) missing.push(REQUIRED_FIELD_QUESTIONS.mission);
      if (!raw.objective) missing.push(REQUIRED_FIELD_QUESTIONS.objective);
      if (!raw.riskLevel) missing.push(REQUIRED_FIELD_QUESTIONS.riskLevel);
      if (!raw.executionStyle) missing.push(REQUIRED_FIELD_QUESTIONS.executionStyle);

      if (missing.length > 0 || confidence < CONFIDENCE_THRESHOLD) {
        const merged = Array.from(new Set([...questions, ...missing]));
        return {
          status: 'needs_clarification',
          spec: null,
          clarifyingQuestions: merged.length > 0 ? merged : ['Could you say more about what you want this agent to do?'],
        };
      }

      return {
        status: 'ok',
        spec: {
          mission: raw.mission!,
          objective: raw.objective!,
          riskLevel: raw.riskLevel!,
          suggestedCapital: raw.suggestedCapital,
          executionStyle: raw.executionStyle!,
          confidence,
        },
        clarifyingQuestions: [],
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES - 1) continue;
    }
  }

  return {
    status: 'failed',
    spec: null,
    clarifyingQuestions: [],
    error: `Hugging Face intent parsing failed: ${lastError}`,
  };
}
