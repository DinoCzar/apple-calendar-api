import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { config, isAuthConfigured, isICloudConfigured, isTursoConfigured } from './config';
import { initDb } from './db';
import { requireAuth } from './middleware/auth';
import authRouter from './routes/auth';
import smartEventsRouter from './routes/smart-events';
import settingsRouter from './routes/settings';
import syncRouter from './routes/sync';

function resolveClientDist(): string {
  const candidates = [
    path.join(process.cwd(), 'client', 'dist'),
    path.join(__dirname, '../../client/dist'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }

  return candidates[0];
}

async function main() {
  if (
    process.env.NODE_ENV === 'production' &&
    (!isAuthConfigured() || !isICloudConfigured() || !isTursoConfigured())
  ) {
    throw new Error(
      'Set AUTH_PASSWORD, SESSION_SECRET, ICLOUD_USERNAME, ICLOUD_APP_PASSWORD, TURSO_DATABASE_URL, and TURSO_AUTH_TOKEN for production'
    );
  }

  await initDb();

  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/smart-events', requireAuth, smartEventsRouter);
  app.use('/api/settings', requireAuth, settingsRouter);
  app.use('/api/sync', requireAuth, syncRouter);

  const clientDist = resolveClientDist();
  if (!fs.existsSync(path.join(clientDist, 'index.html'))) {
    console.warn(
      `UI build not found at ${clientDist}. Run "npm run build" before starting in production.`
    );
  } else {
    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
  }

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const indexPath = path.join(clientDist, 'index.html');
    if (!fs.existsSync(indexPath)) {
      res
        .status(503)
        .send('Smart Events UI is not built yet. Redeploy after running npm run build.');
      return;
    }

    res.sendFile(indexPath, (err) => {
      if (err) next(err);
    });
  });

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Server running on port ${config.port}`);
    console.log(`Serving UI from ${clientDist}`);
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
