import { Router } from 'express';
import { z } from 'zod';
import { createChallenge, verifyChallenge } from '../authService.js';

export const authRouter = Router();

function handleError(res: import('express').Response, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  res.status(400).json({ error: message });
}

authRouter.post('/challenge', (req, res) => {
  const schema = z.object({ publicKey: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const { nonce, message } = createChallenge(parsed.data.publicKey);
    res.json({ success: true, nonce, message });
  } catch (error) {
    handleError(res, error);
  }
});

authRouter.post('/verify', (req, res) => {
  const schema = z.object({ publicKey: z.string().min(1), signature: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const { token } = verifyChallenge(parsed.data.publicKey, parsed.data.signature);
    res.json({ success: true, token, user: { publicKey: parsed.data.publicKey } });
  } catch (error) {
    handleError(res, error);
  }
});
