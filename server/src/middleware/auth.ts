import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config, isAuthConfigured } from '../config';

const SESSION_COOKIE = 'smart_events_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionPayload {
  u: string;
  exp: number;
}

function sign(value: string): string {
  return crypto
    .createHmac('sha256', config.auth.sessionSecret)
    .update(value)
    .digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createSessionToken(username: string): string {
  const payload: SessionPayload = {
    u: username,
    exp: Date.now() + SESSION_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  if (!safeEqual(sign(body), signature)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    ) as SessionPayload;
    if (!payload.u || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, username: string): void {
  const token = createSessionToken(username);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.auth.secureCookies,
    sameSite: 'lax',
    maxAge: SESSION_MS,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: config.auth.secureCookies,
    sameSite: 'lax',
    path: '/',
  });
}

export function verifyLogin(username: string, password: string): boolean {
  if (!isAuthConfigured()) return false;
  const expectedUsername = config.auth.username || config.icloud.username;
  return (
    safeEqual(username, expectedUsername) &&
    safeEqual(password, config.auth.password)
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthConfigured()) {
    res.status(503).json({
      error:
        'Authentication is not configured. Set ICLOUD_USERNAME, ICLOUD_APP_PASSWORD, and SESSION_SECRET.',
    });
    return;
  }

  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: 'Login required' });
    return;
  }

  const session = verifySessionToken(token);
  if (!session) {
    res.status(401).json({ error: 'Session expired. Please log in again.' });
    return;
  }

  req.user = session.u;
  next();
}
