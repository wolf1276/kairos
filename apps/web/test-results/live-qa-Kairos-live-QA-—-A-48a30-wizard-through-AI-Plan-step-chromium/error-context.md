# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: live-qa.spec.ts >> Kairos live QA — Agent Creation end-to-end >> 4-9. Open Create Agent wizard through AI Plan step
- Location: e2e/live-qa.spec.ts:266:7

# Error details

```
Test timeout of 300000ms exceeded.
```

```
Error: page.waitForTimeout: Target page, context or browser has been closed
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - navigation [ref=e2]:
    - generic [ref=e3]:
      - link "Kairos KAIROS" [ref=e4] [cursor=pointer]:
        - /url: /dashboard
        - img "Kairos" [ref=e5]
        - generic [ref=e6]: KAIROS
      - generic [ref=e7]:
        - link "Overview" [ref=e8] [cursor=pointer]:
          - /url: /dashboard
        - link "Agents" [ref=e9] [cursor=pointer]:
          - /url: /dashboard/agents
        - link "Context" [ref=e10] [cursor=pointer]:
          - /url: /dashboard/context
    - generic [ref=e11]:
      - button "Settings" [ref=e13]:
        - img [ref=e14]
      - button "GDG5…KIUE" [ref=e18]:
        - generic [ref=e20]: GDG5…KIUE
  - main [ref=e22]:
    - generic [ref=e24]:
      - generic [ref=e25]:
        - generic [ref=e26]:
          - img [ref=e28]
          - generic [ref=e31]:
            - generic [ref=e32]:
              - heading "Agent Fleet" [level=1] [ref=e33]
              - generic [ref=e34]: idle
            - paragraph [ref=e36]: Operating system for your autonomous capital.
        - generic [ref=e37]:
          - generic [ref=e38]:
            - img
            - textbox "Search agents…" [ref=e39]
          - button "Notifications" [ref=e40]:
            - img [ref=e41]
          - button "Create Agent" [ref=e44]:
            - img [ref=e45]
            - text: Create Agent
          - generic [ref=e46]:
            - img [ref=e47]
            - text: GDG5GU…KIUE
      - paragraph [ref=e52]: Your smart wallet hasn't finished deploying yet.
  - button "Open Next.js Dev Tools" [ref=e58] [cursor=pointer]:
    - img [ref=e59]
  - alert [ref=e62]
  - generic [ref=e64]:
    - img [ref=e66]
    - generic [ref=e69]:
      - paragraph [ref=e70]: Couldn't finish setting up your account
      - paragraph [ref=e71]: Smart wallet deployed on-chain but registry registration failed — retry to re-link it
    - button "Retry" [ref=e72]
```

# Test source

```ts
  184 |             // Unhandled message type — leave unanswered; freighter-api's own
  185 |             // 2s timeout (for connection-status/public-key requests) or the
  186 |             // caller's own timeout will surface it clearly in test output.
  187 |             break;
  188 |         }
  189 |       } catch (e: any) {
  190 |         reply({ apiError: e?.message || String(e) });
  191 |       }
  192 |     });
  193 |   });
  194 | }
  195 | 
  196 | async function completeWalletPicker(page: Page) {
  197 |   // ConnectWalletModal: click "Connect Freighter" -> picker modal opens -> click "Freighter"
  198 |   // row -> consent screen -> click "Continue". Uses expect(...).toBeVisible (polling, no
  199 |   // fixed sleeps) since the button may not have hydrated yet right after networkidle.
  200 |   const connectBtn = page.getByRole('button', { name: 'Connect Freighter' });
  201 |   const alreadyConnected = await page.getByRole('button', { name: /^G[A-Z0-9]{3,4}…[A-Z0-9]{3,4}$/ }).isVisible().catch(() => false);
  202 |   if (alreadyConnected) return true;
  203 |   if (!(await connectBtn.isVisible({ timeout: 10_000 }).catch(() => false))) return false;
  204 |   await connectBtn.click();
  205 |   const freighterRow = page.getByRole('listitem').filter({ hasText: 'Freighter' }).getByRole('button');
  206 |   await expect(freighterRow).toBeVisible({ timeout: 5000 });
  207 |   await freighterRow.click({ force: true });
  208 |   const continueBtn = page.getByRole('button', { name: 'Continue' });
  209 |   if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
  210 |     await continueBtn.click({ force: true });
  211 |   }
  212 |   // Deterministic signal: wait for the connected-address chip to replace the connect button,
  213 |   // which only renders after SEP-53 challenge/verify + auth token is set.
  214 |   await expect(page.getByRole('button', { name: /^G[A-Z0-9]{3,4}…[A-Z0-9]{3,4}$/ })).toBeVisible({ timeout: 20_000 });
  215 |   return true;
  216 | }
  217 | 
  218 | test.describe.serial('Kairos live QA — Agent Creation end-to-end', () => {
  219 |   test.setTimeout(300_000);
  220 | 
  221 |   test('0. fund real testnet keypair via friendbot', async () => {
  222 |     const ok = await fundTestnetAccount(PUBKEY);
  223 |     console.log(`[QA] Test keypair: ${PUBKEY} funded=${ok}`);
  224 |     expect(ok).toBeTruthy();
  225 |   });
  226 | 
  227 |   test('1-3. Connect wallet, open Agents page, verify no auto wallet popup', async ({ page }) => {
  228 |     const requests: string[] = [];
  229 |     const consoleErrors: string[] = [];
  230 |     page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  231 |     page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
  232 |     page.on('request', (r) => requests.push(`${r.method()} ${r.url()}`));
  233 | 
  234 |     await installRealSigningFreighterMock(page);
  235 | 
  236 |     // Track whether requestAccess/signTransaction/signMessage were called before any
  237 |     // user-initiated click — instrument via a window flag incremented from the shim itself.
  238 |     await page.addInitScript(() => {
  239 |       (window as any).__kairosSignCallLog = [];
  240 |       const origExpose = () => {};
  241 |     });
  242 | 
  243 |     await page.goto('http://localhost:3000/dashboard/agents');
  244 |     await page.waitForLoadState('networkidle');
  245 | 
  246 |     // Step 3: opening Agents page alone must not trigger any Freighter popup / sign call.
  247 |     // We check this by confirming no auth/session call happened yet (no POST to
  248 |     // /api/auth/challenge or /api/auth/verify) since the app is not "connected" until
  249 |     // the user clicks Connect.
  250 |     const authCallsBeforeConnect = requests.filter((r) => /\/api\/auth\/(challenge|verify)/.test(r));
  251 |     console.log('[QA] Auth calls before Connect click:', authCallsBeforeConnect.length);
  252 |     expect(authCallsBeforeConnect.length).toBe(0);
  253 | 
  254 |     await expect(page.getByRole('button', { name: 'Connect Freighter' })).toBeVisible({ timeout: 10_000 });
  255 | 
  256 |     // Now perform the actual user-initiated connect.
  257 |     await completeWalletPicker(page);
  258 | 
  259 |     const authCallsAfterConnect = requests.filter((r) => /\/api\/auth\/(challenge|verify)/.test(r));
  260 |     console.log('[QA] Auth calls after Connect click:', authCallsAfterConnect);
  261 |     console.log('[QA] Console errors so far:', consoleErrors);
  262 | 
  263 |     await page.screenshot({ path: 'test-results/qa-01-after-connect.png', fullPage: true });
  264 |   });
  265 | 
  266 |   test('4-9. Open Create Agent wizard through AI Plan step', async ({ page }) => {
  267 |     const responses: string[] = [];
  268 |     page.on('response', (r) => responses.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  269 |     page.on('pageerror', (err) => console.log('[QA] pageerror:', err.message));
  270 | 
  271 |     await installRealSigningFreighterMock(page);
  272 |     await page.goto('http://localhost:3000/dashboard/agents');
  273 |     await page.waitForLoadState('networkidle');
  274 | 
  275 |     await completeWalletPicker(page);
  276 | 
  277 |     await page.screenshot({ path: 'test-results/qa-02-agents-page.png', fullPage: true });
  278 | 
  279 |     const createBtn = page.locator('button:has-text("Create Agent")').first();
  280 |     await expect(createBtn).toBeEnabled({ timeout: 20_000 }).catch(async () => {
  281 |       console.log('[QA] Create Agent button not enabled — smart wallet likely not ready.');
  282 |     });
  283 |     await createBtn.click({ trial: false }).catch(() => {});
> 284 |     await page.waitForTimeout(1000);
      |                ^ Error: page.waitForTimeout: Target page, context or browser has been closed
  285 | 
  286 |     // Step: Describe Goal
  287 |     const textarea = page.locator('textarea');
  288 |     if (await textarea.isVisible().catch(() => false)) {
  289 |       await textarea.fill('Grow my XLM over the long term while keeping risk low.');
  290 |       await page.screenshot({ path: 'test-results/qa-03-describe-goal.png', fullPage: true });
  291 |       await page.click('text=Analyze');
  292 |       await page.waitForTimeout(3000);
  293 |     }
  294 | 
  295 |     await page.screenshot({ path: 'test-results/qa-04-ai-understanding.png', fullPage: true });
  296 |     const parseIntentCalls = responses.filter((r) => r.includes('/api/agents/parse-intent'));
  297 |     console.log('[QA] parse-intent calls:', parseIntentCalls);
  298 | 
  299 |     // Step: AI Understanding -> Continue
  300 |     const continueBtn = page.locator('button:has-text("Continue")').first();
  301 |     if (await continueBtn.isVisible().catch(() => false)) {
  302 |       await continueBtn.click();
  303 |       await page.waitForTimeout(500);
  304 |     }
  305 |     await page.screenshot({ path: 'test-results/qa-05-capital-safety.png', fullPage: true });
  306 | 
  307 |     // Capital & Safety -> Continue
  308 |     if (await page.locator('button:has-text("Continue")').first().isVisible().catch(() => false)) {
  309 |       await page.click('button:has-text("Continue")');
  310 |       await page.waitForTimeout(500);
  311 |     }
  312 |     await page.screenshot({ path: 'test-results/qa-06-permissions.png', fullPage: true });
  313 | 
  314 |     // Permissions -> Continue
  315 |     if (await page.locator('button:has-text("Continue")').first().isVisible().catch(() => false)) {
  316 |       await page.click('button:has-text("Continue")');
  317 |       await page.waitForTimeout(500);
  318 |     }
  319 |     await page.screenshot({ path: 'test-results/qa-07-ai-plan.png', fullPage: true });
  320 | 
  321 |     console.log('[QA] All responses so far:', JSON.stringify(responses.filter((r) => r.includes('/api/')), null, 2));
  322 |   });
  323 | 
  324 |   test('10-14. Smart wallet, delegation approval, agent creation submit', async ({ page }) => {
  325 |     const responses: { status: number; method: string; url: string; body?: string }[] = [];
  326 |     page.on('response', async (r) => {
  327 |       const url = r.url();
  328 |       if (url.includes('/api/')) {
  329 |         let body: string | undefined;
  330 |         try { body = (await r.text()).slice(0, 500); } catch {}
  331 |         responses.push({ status: r.status(), method: r.request().method(), url, body });
  332 |       }
  333 |     });
  334 |     const consoleErrors: string[] = [];
  335 |     page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  336 |     page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
  337 | 
  338 |     await installRealSigningFreighterMock(page);
  339 |     await page.goto('http://localhost:3000/dashboard/agents');
  340 |     await page.waitForLoadState('networkidle');
  341 | 
  342 |     await completeWalletPicker(page);
  343 | 
  344 |     const beforeAgents = sqlite(`select count(*) from agents;`);
  345 |     const beforeWallets = sqlite(`select count(*) from smart_wallets where owner='${PUBKEY}';`);
  346 |     console.log(`[QA] DB before: agents=${beforeAgents} walletsForOwner=${beforeWallets}`);
  347 | 
  348 |     await page.screenshot({ path: 'test-results/qa-08-before-wizard.png', fullPage: true });
  349 | 
  350 |     const createBtn = page.locator('button:has-text("Create Agent")').first();
  351 |     const enabled = await createBtn.isEnabled().catch(() => false);
  352 |     console.log('[QA] Create Agent button enabled:', enabled);
  353 |     if (!enabled) {
  354 |       console.log('[QA] Cannot proceed — wallet likely never finished deploying (needs real on-chain smart-wallet deploy).');
  355 |       console.log('[QA] Console errors:', consoleErrors);
  356 |       console.log('[QA] Responses:', JSON.stringify(responses, null, 2));
  357 |       return;
  358 |     }
  359 |     await createBtn.click();
  360 |     await page.waitForTimeout(500);
  361 | 
  362 |     const textarea = page.locator('textarea');
  363 |     await textarea.fill('Grow my XLM over the long term while keeping risk low.');
  364 |     await page.click('text=Analyze');
  365 |     await page.waitForTimeout(3000);
  366 | 
  367 |     for (let i = 0; i < 3; i++) {
  368 |       const btn = page.locator('button:has-text("Continue")').first();
  369 |       if (await btn.isVisible().catch(() => false)) { await btn.click(); await page.waitForTimeout(500); }
  370 |     }
  371 | 
  372 |     // Smart Wallet step
  373 |     await page.screenshot({ path: 'test-results/qa-09-smart-wallet-step.png', fullPage: true });
  374 |     const createWalletBtn = page.locator('button:has-text("Create Smart Wallet")');
  375 |     if (await createWalletBtn.isVisible().catch(() => false)) {
  376 |       console.log('[QA] No smart wallet found — clicking Create Smart Wallet (real on-chain deploy).');
  377 |       await createWalletBtn.click();
  378 |       await page.waitForTimeout(20_000);
  379 |       await page.screenshot({ path: 'test-results/qa-10-after-deploy-attempt.png', fullPage: true });
  380 |     }
  381 | 
  382 |     // Funding step: the deployed smart wallet contract starts at 0 XLM — the wizard
  383 |     // correctly blocks Continue until balance > 0 (no in-wizard fund button exists by
  384 |     // design; real users fund externally, e.g. via the Trade/delegate flow). Extract the
```