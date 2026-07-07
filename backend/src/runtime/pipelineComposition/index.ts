// Public surface of Pipeline Composition (Phase 13) — the Composition Root. Callers import only
// from here: `const kairos = createKairos(config); await kairos.start();`.
export { createPipelineStages, createPipelineRunner, createRuntime, createKairos } from './composition.js';
export type { KairosCompositionConfig, TelemetryProvider } from './types.js';
