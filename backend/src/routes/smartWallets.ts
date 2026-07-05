import { Router } from 'express';
import { z } from 'zod';
import { listSmartWallets, upsertSmartWallet } from '../db.js';

export const smartWalletsRouter = Router();

smartWalletsRouter.get('/', (req, res) => {
  res.json({ success: true, wallets: listSmartWallets(req.auth!.publicKey) });
});

const registerSchema = z.object({
  address: z.string(),
  label: z.string().optional(),
  network: z.string().optional(),
});

smartWalletsRouter.post('/', (req, res) => {
  const parsed = registerSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  upsertSmartWallet(req.auth!.publicKey, parsed.data.address, parsed.data.label ?? null, parsed.data.network ?? null);
  res.json({ success: true, wallets: listSmartWallets(req.auth!.publicKey) });
});
