import type { NextFunction, Request, Response } from 'express';
import { verifySessionToken } from './authService.js';
import { getDevAllowlist } from './config.js';

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

/** Hidden "Developer Mode" gate — must be mounted AFTER requireAuth (relies on req.auth being
 *  set). Checks the authenticated caller's Stellar public key against DEV_ALLOWLIST
 *  (config.ts::getDevAllowlist), read fresh from process.env on every request rather than
 *  cached, so a deployment can change the allowlist without a restart-sensitive code path.
 *  Never trusts any client-supplied header/body/query flag — membership is decided purely from
 *  the server-verified JWT subject already attached by requireAuth. */
export function requireDev(req: Request, res: Response, next: NextFunction) {
  const publicKey = req.auth?.publicKey;
  if (!publicKey) {
    // Should be unreachable when mounted after requireAuth, but fail closed rather than assume.
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }
  const allowlist = new Set(getDevAllowlist());
  if (!allowlist.has(publicKey)) {
    return res.status(403).json({ error: 'Developer Mode is not enabled for this account' });
  }
  next();
}
