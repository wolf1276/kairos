import type { NextFunction, Request, Response } from 'express';
import { verifySessionToken } from './authService.js';

declare global {
  namespace Express {
    interface Request {
      auth?: { publicKey: string };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }
  try {
    req.auth = verifySessionToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session token' });
  }
}
