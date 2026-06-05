import { Router } from 'express';
import { isAuthConfigured } from '../config';
import {
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
  verifyLogin,
} from '../middleware/auth';

const router = Router();

router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.user });
});

router.post('/login', (req, res) => {
  if (!isAuthConfigured()) {
    res.status(503).json({
      error: 'Authentication is not configured on the server.',
    });
    return;
  }

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  if (!verifyLogin(username, password)) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  setSessionCookie(res, username);
  res.json({ username });
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).send();
});

export default router;
