import type { RuntimeLogger } from './types.js';

/** Default logger: structured console output, one line per lifecycle event. Injectable so tests
 *  and hosts (e.g. a real log pipeline) can supply their own without touching runtime.ts. */
export const consoleRuntimeLogger: RuntimeLogger = {
  info(message, meta) {
    console.log(`[autonomous-runtime] ${message}`, meta ?? {});
  },
  warn(message, meta) {
    console.warn(`[autonomous-runtime] ${message}`, meta ?? {});
  },
  error(message, meta) {
    console.error(`[autonomous-runtime] ${message}`, meta ?? {});
  },
};
