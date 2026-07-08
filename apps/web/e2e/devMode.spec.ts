import { test, expect, Page } from '@playwright/test';

// Confirms the hidden Developer Mode surface (DevPanel.tsx / GET /api/dev/status) stays
// completely inert for a caller the backend hasn't allowlisted: no "Developer Mode" badge/panel
// renders, and none of the /api/dev/* endpoints are ever called beyond the one status check.
// Same Freighter-mocking approach as demo.spec.ts.

async function mockFreighter(page: Page) {
  await page.addInitScript(() => {
    const mock = {
      requestAccess: () =>
        Promise.resolve({ address: 'GA7QNFM3WQZ7O3YJ3LG7QZ7O3YJ3LG7QZ7O3YJ3LG7QZ7O3YJ3LG7QZ7', error: undefined }),
      getAddress: () =>
        Promise.resolve({ address: 'GA7QNFM3WQZ7O3YJ3LG7QZ7O3YJ3LG7QZ7O3YJ3LG7QZ7O3YJ3LG7QZ7', error: undefined }),
      getNetworkDetails: () =>
        Promise.resolve({
          network: 'TESTNET',
          networkUrl: 'https://horizon-testnet.stellar.org',
          networkPassphrase: 'Test SDF Network ; September 2015',
          sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
          error: undefined,
        }),
      isConnected: () => Promise.resolve({ isConnected: true, error: undefined }),
      signTransaction: () =>
        Promise.resolve({
          signedTxXdr: 'AAAAAgAAAABpBNJGqd2eHq9KjQ8pHQ8pHA8pHQ8pHQ8pHQ8pHQ8pHQ8=',
          signerAddress: 'GA7QNFM3WQZ7O3YJ3LG7QZ7O3YJ3LG7QZ7O3YJ3LG7QZ7O3YJ3LG7QZ7',
          error: undefined,
        }),
    };
    (window as Record<string, unknown>).__freighterMock = mock;
    (window as Record<string, unknown>).freighter = {};
    Object.defineProperty(window, 'freighter', { value: {}, writable: false });
  });

  await page.route('**freighter-api**', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `
        const mock = (window).__freighterMock;
        export function requestAccess() { return mock.requestAccess(); }
        export function getAddress() { return mock.getAddress(); }
        export function getNetworkDetails() { return mock.getNetworkDetails(); }
        export function isConnected() { return mock.isConnected(); }
        export function signTransaction(xdr, opts) { return mock.signTransaction(xdr, opts); }
      `,
    });
  });
}

test.describe('Developer Mode gating', () => {
  test('DevPanel does not render and no other /api/dev/* calls fire when /api/dev/status 403s', async ({ page }) => {
    await mockFreighter(page);

    const otherDevCalls: string[] = [];

    // Stand in for the agent-wallet backend (NEXT_PUBLIC_AGENTS_BACKEND_URL) without requiring a
    // live backend process — status always 403s (the "not allowlisted" case this test targets),
    // and any other /api/dev/* call is recorded so the assertion below can catch a leak.
    await page.route('**/api/dev/status', async (route) => {
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Developer Mode is not enabled for this account' }) });
    });
    await page.route('**/api/dev/**', async (route) => {
      const url = route.request().url();
      if (!url.includes('/api/dev/status')) {
        otherDevCalls.push(url);
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'forbidden' }) });
        return;
      }
      await route.continue();
    });

    await page.goto('/dashboard/agents');
    await page.waitForLoadState('networkidle');

    // No "Developer Mode" badge/copy anywhere on the page for a non-allowlisted caller.
    await expect(page.locator('text=Developer Mode')).toHaveCount(0);
    await expect(page.locator('text=Developer Controls')).toHaveCount(0);

    // Only the status probe may have fired — never any of the other dev endpoints.
    expect(otherDevCalls).toEqual([]);
  });
});
