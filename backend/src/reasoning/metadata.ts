// Metadata assembly for the Reasoning Engine. Stamps every CandidateDecision with the versions
// and hashes needed to replay or audit it later. No provider implementation, no LLM calls.
import { REASONING_ENGINE_SCHEMA_VERSION, PROMPT_TEMPLATE_VERSION } from './types.js';
import type { CandidateDecisionMetadata } from './types.js';

export interface BuildMetadataInput {
  providerVersion: string;
  buildDurationMs: number;
  reasoningHash: string;
  promptHash: string;
}

export function buildCandidateDecisionMetadata(input: BuildMetadataInput): CandidateDecisionMetadata {
  return {
    reasoningVersion: REASONING_ENGINE_SCHEMA_VERSION,
    promptVersion: PROMPT_TEMPLATE_VERSION,
    providerVersion: input.providerVersion,
    buildDurationMs: input.buildDurationMs,
    reasoningHash: input.reasoningHash,
    promptHash: input.promptHash,
    schemaVersion: REASONING_ENGINE_SCHEMA_VERSION,
  };
}
