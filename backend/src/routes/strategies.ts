import { Router } from 'express';
import { listStrategyMeta } from '../strategies/index.js';

export const strategiesRouter = Router();

// Public metadata only (id/name/category/description) — never exposes the `evaluate`
// functions themselves, which stay server-side.
strategiesRouter.get('/', (_req, res) => {
  res.json({ success: true, strategies: listStrategyMeta() });
});
