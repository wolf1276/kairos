import cors from 'cors';
import express from 'express';
import { agentsRouter } from './routes/agents.js';
import { strategiesRouter } from './routes/strategies.js';
import { startScheduler } from './runner.js';
import { getAllowedOrigin, getPort } from './config.js';

const app = express();
app.use(cors({ origin: getAllowedOrigin() }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/agents', agentsRouter);
app.use('/api/strategies', strategiesRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: message });
});

const port = getPort();
app.listen(port, () => {
  console.log(`kairos-agent-backend listening on :${port}`);
  startScheduler();
});
