import { afterEach, describe, expect, it } from 'vitest';
import { getAllowedOrigin } from '../config.js';

describe('getAllowedOrigin (CORS fail-closed)', () => {
  const original = process.env.ALLOWED_ORIGIN;
  afterEach(() => {
    if (original === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = original;
  });

  it('never falls back to a wildcard when unset', () => {
    delete process.env.ALLOWED_ORIGIN;
    expect(getAllowedOrigin()).not.toBe('*');
    expect(getAllowedOrigin()).toBe('http://localhost:3000');
  });

  it('uses the configured origin verbatim', () => {
    process.env.ALLOWED_ORIGIN = 'https://kairos.vercel.app';
    expect(getAllowedOrigin()).toBe('https://kairos.vercel.app');
  });
});
