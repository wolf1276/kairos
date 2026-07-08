import { test, expect, Page } from '@playwright/test';

// Mock Freighter before page loads
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

    // Patch import via define to intercept freighter-api
    Object.defineProperty(window, 'freighter', { value: {}, writable: false });
  });

  // Intercept freighter-api JS bundle
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

test.describe('Kairos E2E', () => {
  test('landing page renders and shows launch button', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Kairos').first()).toBeVisible();
    await expect(page.locator('a[href="/dashboard"]').first()).toBeVisible();
  });

  test('dashboard page loads', async ({ page }) => {
    await mockFreighter(page);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.waitForLoadState('networkidle');
  });

  test('/api/analyze endpoint returns a decision', async ({ request }) => {
    const res = await request.post('/api/analyze', {
      data: {
        symbol: 'XLMUSDT',
        automationMode: 'STRATEGY_MANAGED',
        delegatedAmount: 1000,
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.action).toBeDefined();
    expect(['BUY', 'SELL', 'HOLD']).toContain(body.action);
    expect(body.confidence).toBeGreaterThanOrEqual(0);
    expect(body.confidence).toBeLessThanOrEqual(1);
    expect(body.reasoning).toBeTruthy();
  });
});
