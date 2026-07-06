// Provider selection is entirely configuration-driven: the orchestrator calls createProvider()
// and never knows or cares which concrete class it received.
import { getProviderConstructor } from './registry.js';
import { getProviderConfigFromEnv } from './config.js';
import type { ReasoningProvider } from '../interfaces.js';
import type { ProviderCallConfig } from './types.js';

export function createProvider(config: ProviderCallConfig = getProviderConfigFromEnv()): ReasoningProvider {
  const Ctor = getProviderConstructor(config.provider);
  return new Ctor(config);
}
