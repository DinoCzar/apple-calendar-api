import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { initDb } from './db';
import smartEventsRouter from './routes/smart-events';
import settingsRouter from './routes/settings';
import syncRouter from './routes/sync';

async function main() {
  await initDb();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/smart-events', smartEventsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/sync', syncRouter);

  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) next();
    });
  });

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
