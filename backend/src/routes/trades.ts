import { Router } from 'express';
import { z } from 'zod';
import { insertTrade } from '../tradeService.js';
import { recordCompletedTrade } from '../executionEngine.js';

export const tradesRouter = Router();

const manualTradeSchema = z.object({
  side: z.enum(['buy', 'sell']),
  pair: z.string(),
  amount: z.string(),
  price: z.string(),
  txHash: z.string(),
});

tradesRouter.post('/manual', (req, res) => {
  const parsed = manualTradeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const trade = insertTrade({
      agentId: `manual:${req.auth!.publicKey}`,
      strategyId: 'manual',
      side: parsed.data.side,
      pair: parsed.data.pair,
      amount: parsed.data.amount,
      price: parsed.data.price,
      txHash: parsed.data.txHash,
      status: 'success',
      realizedPnl: null,
      mode: 'live',
    });
    res.json({ success: true, trade });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
  }
});
