// Prompt Builder — deterministic assembly of structured prompt input from a ReasoningContext.
// Never calls an LLM, never performs I/O. Identical ReasoningContext + template version must
// always produce an identical Prompt (including hash).
import { getPromptTemplate } from './promptTemplate.js';
import { hashPromptSections } from './hashing.js';
import { PROMPT_TEMPLATE_VERSION } from './types.js';
import type { ReasoningContext, Prompt } from './types.js';

export function buildPrompt(context: ReasoningContext, templateVersion: string = PROMPT_TEMPLATE_VERSION): Prompt {
  const template = getPromptTemplate(templateVersion);
  const sections = template(context);
  const promptHash = hashPromptSections(sections);

  return Object.freeze({
    templateVersion,
    sections: Object.freeze({ ...sections }),
    promptHash,
  });
}
