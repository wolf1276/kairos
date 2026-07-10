import { Router } from 'express';
import { z } from 'zod';
import { listSmartWallets, upsertSmartWallet } from '../smartWalletsDb.js';

export const smartWalletsRouter = Router();

smartWalletsRouter.get('/', async (req, res) => {
  try {
    const wallets = await listSmartWallets(req.auth!.publicKey);
    res.json({ success: true, owner: req.auth!.publicKey, wallets });
  } catch (err) {
    // Owner is known from the auth token regardless of DB outcome — callers (e.g.
    // apps/web/app/api/connect/check/route.ts) need it to fall back to the on-chain Registry
    // when the DB is unavailable, so it must be present on error too, not just on success.
    res.status(503).json({ error: `Failed to read smart wallets: ${(err as Error).message}`, owner: req.auth!.publicKey });
  }
});

const registerSchema = z.object({
  address: z.string(),
  label: z.string().optional(),
  network: z.string().optional(),
});

smartWalletsRouter.post('/', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    // upsertSmartWallet verifies the write (reads the row back) before resolving — see
    // smartWalletsDb.ts. If that throws, the DB write failed or couldn't be confirmed, so we
    // must fail the request rather than report success on an unverified write.
    await upsertSmartWallet(req.auth!.publicKey, parsed.data.address, parsed.data.label ?? null, parsed.data.network ?? null);
    const wallets = await listSmartWallets(req.auth!.publicKey);
    res.json({ success: true, owner: req.auth!.publicKey, wallets });
  } catch (err) {
    res.status(503).json({ error: `Failed to persist smart wallet: ${(err as Error).message}` });
  }
});
