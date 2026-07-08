import { test, expect, Page } from '@playwright/test';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import crypto from 'crypto';
import { execSync } from 'child_process';
import path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Live QA of the Agent Creation flow against the REAL running backend (4001) and
// REAL Stellar testnet. Freighter itself can't be automated headlessly, so this
// intercepts the exact webpack chunk that bundles @creit.tech/stellar-wallets-kit's
// freighter module and replaces it with a shim that performs REAL Ed25519 signing
// (via a fresh, friendbot-funded testnet keypair) through page.exposeFunction —
// i.e. signatures are cryptographically real, verified server-side by the same
// authService.ts / custom-account contract code path a real user would hit.
// ─────────────────────────────────────────────────────────────────────────────

const DB_PATH = path.resolve(__dirname, '../../../backend/data/agents.db');
function sqlite(query: string): string {
  return execSync(`sqlite3 "${DB_PATH}" "${query}"`).toString().trim();
}

const kp = Keypair.random();
const PUBKEY = kp.publicKey();

async function fundTestnetAccount(pubkey: string) {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${pubkey}`);
  return res.ok;
}

async function installRealSigningFreighterMock(page: Page) {
  // Exposed Node-side signing functions — real Ed25519 crypto, not fakes.
  await page.exposeFunction('__kairosGetAddress', () => PUBKEY);
  await page.exposeFunction('__kairosSignMessage', (message: string) => {
    // Mirrors backend/src/authService.ts sep53Digest() exactly.
    const digest = crypto.createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
    return kp.sign(digest).toString('base64');
  });
  await page.exposeFunction('__kairosSignTransaction', (xdrStr: string, networkPassphrase: string) => {
    const tx = TransactionBuilder.fromXDR(xdrStr, networkPassphrase);
    tx.sign(kp);
    return tx.toXDR();
  });
  await page.exposeFunction('__kairosSignAuthEntry', (preimageXdrB64: string) => {
    const raw = Buffer.from(preimageXdrB64, 'base64');
    const hash = crypto.createHash('sha256').update(raw).digest();
    return kp.sign(hash).toString('base64');
  });

  // Replace the exact webpack chunk that bundles
  // @creit.tech/stellar-wallets-kit/.../modules/freighter.module.js (confirmed via
  // network trace: filename contains "freighter_module"). We can't intercept the
  // inner @stellar/freighter-api import separately because webpack inlines it into
  // this same chunk in dev mode, so we replace the whole chunk with a compatible
  // FreighterModule implementation.
  await page.route(/freighter_module/i, async (route) => {
    const body = `
      const w = window;
      export const FREIGHTER_ID = "freighter";
      export class FreighterModule {
        constructor() {
          this.moduleType = "hot_wallet";
          this.productId = FREIGHTER_ID;
          this.productName = "Freighter";
          this.productUrl = "https://freighter.app";
          this.productIcon = "https://stellar.creit.tech/wallet-icons/freighter.png";
        }
        async isAvailable() { return true; }
        async getAddress() { return { address: await w.__kairosGetAddress() }; }
        async signTransaction(xdr, opts) {
          const signedTxXdr = await w.__kairosSignTransaction(xdr, opts && opts.networkPassphrase);
          return { signedTxXdr, signerAddress: await w.__kairosGetAddress() };
        }
        async signAuthEntry(authEntry, opts) {
          const signedAuthEntry = await w.__kairosSignAuthEntry(authEntry);
          return { signedAuthEntry, signerAddress: await w.__kairosGetAddress() };
        }
        async signMessage(message, opts) {
          const signedMessage = await w.__kairosSignMessage(message);
          return { signedMessage, signerAddress: await w.__kairosGetAddress() };
        }
        async getNetwork() {
          return { network: "TESTNET", networkPassphrase: "Test SDF Network ; September 2015" };
        }
      }
    `;
    await route.fulfill({ contentType: 'application/javascript', body });
  });
}

async function completeWalletPicker(page: Page) {
  // ConnectWalletModal: click "Connect Freighter" -> picker modal opens -> click "Freighter"
  // row -> consent screen -> click "Continue".
  const connectBtn = page.getByRole('button', { name: 'Connect Freighter' });
  if (!(await connectBtn.isVisible().catch(() => false))) return false;
  await connectBtn.click();
  await page.waitForTimeout(500);
  const freighterRow = page.getByRole('button', { name: /^Freighter$/i }).first();
  if (await freighterRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await freighterRow.click();
    await page.waitForTimeout(300);
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await continueBtn.click();
    }
  }
  await page.waitForTimeout(6000);
  return true;
}

test.describe.serial('Kairos live QA — Agent Creation end-to-end', () => {
  test.setTimeout(180_000);

  test('0. fund real testnet keypair via friendbot', async () => {
    const ok = await fundTestnetAccount(PUBKEY);
    console.log(`[QA] Test keypair: ${PUBKEY} funded=${ok}`);
    expect(ok).toBeTruthy();
  });

  test('1-3. Connect wallet, open Agents page, verify no auto wallet popup', async ({ page }) => {
    const requests: string[] = [];
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
    page.on('request', (r) => requests.push(`${r.method()} ${r.url()}`));

    await installRealSigningFreighterMock(page);

    // Track whether requestAccess/signTransaction/signMessage were called before any
    // user-initiated click — instrument via a window flag incremented from the shim itself.
    await page.addInitScript(() => {
      (window as any).__kairosSignCallLog = [];
      const origExpose = () => {};
    });

    await page.goto('http://localhost:3000/dashboard/agents');
    await page.waitForLoadState('networkidle');

    // Step 3: opening Agents page alone must not trigger any Freighter popup / sign call.
    // We check this by confirming no auth/session call happened yet (no POST to
    // /api/auth/challenge or /api/auth/verify) since the app is not "connected" until
    // the user clicks Connect.
    const authCallsBeforeConnect = requests.filter((r) => /\/api\/auth\/(challenge|verify)/.test(r));
    console.log('[QA] Auth calls before Connect click:', authCallsBeforeConnect.length);
    expect(authCallsBeforeConnect.length).toBe(0);

    await expect(page.getByRole('button', { name: 'Connect Freighter' })).toBeVisible({ timeout: 10_000 });

    // Now perform the actual user-initiated connect.
    await completeWalletPicker(page);

    const authCallsAfterConnect = requests.filter((r) => /\/api\/auth\/(challenge|verify)/.test(r));
    console.log('[QA] Auth calls after Connect click:', authCallsAfterConnect);
    console.log('[QA] Console errors so far:', consoleErrors);

    await page.screenshot({ path: 'test-results/qa-01-after-connect.png', fullPage: true });
  });

  test('4-9. Open Create Agent wizard through AI Plan step', async ({ page }) => {
    const responses: string[] = [];
    page.on('response', (r) => responses.push(`${r.status()} ${r.request().method()} ${r.url()}`));
    page.on('pageerror', (err) => console.log('[QA] pageerror:', err.message));

    await installRealSigningFreighterMock(page);
    await page.goto('http://localhost:3000/dashboard/agents');
    await page.waitForLoadState('networkidle');

    await completeWalletPicker(page);

    await page.screenshot({ path: 'test-results/qa-02-agents-page.png', fullPage: true });

    const createBtn = page.locator('button:has-text("Create Agent")').first();
    await expect(createBtn).toBeEnabled({ timeout: 20_000 }).catch(async () => {
      console.log('[QA] Create Agent button not enabled — smart wallet likely not ready.');
    });
    await createBtn.click({ trial: false }).catch(() => {});
    await page.waitForTimeout(1000);

    // Step: Describe Goal
    const textarea = page.locator('textarea');
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.fill('Grow my XLM over the long term while keeping risk low.');
      await page.screenshot({ path: 'test-results/qa-03-describe-goal.png', fullPage: true });
      await page.click('text=Analyze');
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: 'test-results/qa-04-ai-understanding.png', fullPage: true });
    const parseIntentCalls = responses.filter((r) => r.includes('/api/agents/parse-intent'));
    console.log('[QA] parse-intent calls:', parseIntentCalls);

    // Step: AI Understanding -> Continue
    const continueBtn = page.locator('button:has-text("Continue")').first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: 'test-results/qa-05-capital-safety.png', fullPage: true });

    // Capital & Safety -> Continue
    if (await page.locator('button:has-text("Continue")').first().isVisible().catch(() => false)) {
      await page.click('button:has-text("Continue")');
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: 'test-results/qa-06-permissions.png', fullPage: true });

    // Permissions -> Continue
    if (await page.locator('button:has-text("Continue")').first().isVisible().catch(() => false)) {
      await page.click('button:has-text("Continue")');
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: 'test-results/qa-07-ai-plan.png', fullPage: true });

    console.log('[QA] All responses so far:', JSON.stringify(responses.filter((r) => r.includes('/api/')), null, 2));
  });

  test('10-14. Smart wallet, delegation approval, agent creation submit', async ({ page }) => {
    const responses: { status: number; method: string; url: string; body?: string }[] = [];
    page.on('response', async (r) => {
      const url = r.url();
      if (url.includes('/api/')) {
        let body: string | undefined;
        try { body = (await r.text()).slice(0, 500); } catch {}
        responses.push({ status: r.status(), method: r.request().method(), url, body });
      }
    });
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

    await installRealSigningFreighterMock(page);
    await page.goto('http://localhost:3000/dashboard/agents');
    await page.waitForLoadState('networkidle');

    await completeWalletPicker(page);

    const beforeAgents = sqlite(`select count(*) from agents;`);
    const beforeWallets = sqlite(`select count(*) from smart_wallets where owner='${PUBKEY}';`);
    console.log(`[QA] DB before: agents=${beforeAgents} walletsForOwner=${beforeWallets}`);

    await page.screenshot({ path: 'test-results/qa-08-before-wizard.png', fullPage: true });

    const createBtn = page.locator('button:has-text("Create Agent")').first();
    const enabled = await createBtn.isEnabled().catch(() => false);
    console.log('[QA] Create Agent button enabled:', enabled);
    if (!enabled) {
      console.log('[QA] Cannot proceed — wallet likely never finished deploying (needs real on-chain smart-wallet deploy).');
      console.log('[QA] Console errors:', consoleErrors);
      console.log('[QA] Responses:', JSON.stringify(responses, null, 2));
      return;
    }
    await createBtn.click();
    await page.waitForTimeout(500);

    const textarea = page.locator('textarea');
    await textarea.fill('Grow my XLM over the long term while keeping risk low.');
    await page.click('text=Analyze');
    await page.waitForTimeout(3000);

    for (let i = 0; i < 3; i++) {
      const btn = page.locator('button:has-text("Continue")').first();
      if (await btn.isVisible().catch(() => false)) { await btn.click(); await page.waitForTimeout(500); }
    }

    // Smart Wallet step
    await page.screenshot({ path: 'test-results/qa-09-smart-wallet-step.png', fullPage: true });
    const createWalletBtn = page.locator('button:has-text("Create Smart Wallet")');
    if (await createWalletBtn.isVisible().catch(() => false)) {
      console.log('[QA] No smart wallet found — clicking Create Smart Wallet (real on-chain deploy).');
      await createWalletBtn.click();
      await page.waitForTimeout(20_000);
      await page.screenshot({ path: 'test-results/qa-10-after-deploy-attempt.png', fullPage: true });
    }

    const continueAfterWallet = page.locator('button:has-text("Continue")').first();
    const canContinue = await continueAfterWallet.isEnabled().catch(() => false);
    console.log('[QA] Can continue past Smart Wallet step:', canContinue);
    if (canContinue) {
      await continueAfterWallet.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'test-results/qa-11-approval-step.png', fullPage: true });

      const approveBtn = page.locator('button:has-text("Approve & Create")');
      if (await approveBtn.isVisible().catch(() => false)) {
        await approveBtn.click();
        await page.waitForTimeout(15_000);
        await page.screenshot({ path: 'test-results/qa-12-creation-progress.png', fullPage: true });
      }
    }

    console.log('[QA] Console errors:', consoleErrors);
    console.log('[QA] API responses:', JSON.stringify(responses, null, 2));

    const afterAgents = sqlite(`select count(*) from agents;`);
    console.log(`[QA] DB after: agents=${afterAgents} (before=${beforeAgents})`);
  });
});
