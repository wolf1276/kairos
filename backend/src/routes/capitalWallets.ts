import { Router } from 'express';
import { z } from 'zod';
import { listCapitalWallets, upsertCapitalWallet } from '../db.js';

export const capitalWalletsRouter = Router();

capitalWalletsRouter.get('/', (req, res) => {
  res.json({ success: true, wallets: listCapitalWallets(req.auth!.publicKey) });
});

const registerSchema = z.object({
  address: z.string(),
  label: z.string().optional(),
});

capitalWalletsRouter.post('/', (req, res) => {
  const parsed = registerSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  upsertCapitalWallet(req.auth!.publicKey, parsed.data.address, parsed.data.label ?? null);
  res.json({ success: true, wallets: listCapitalWallets(req.auth!.publicKey) });
});
