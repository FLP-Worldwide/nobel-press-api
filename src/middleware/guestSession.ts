// src/middleware/guestSession.ts
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

const COOKIE_NAME = 'gid';

export function guestSession() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.id) return next(); // logged-in: no gid needed

    const existing = req.cookies?.[COOKIE_NAME] as string | undefined;
    const gid = existing ?? randomUUID();

    if (!existing) {
      res.cookie(COOKIE_NAME, gid, {
        httpOnly: true,
        sameSite: 'lax',
        // secure: true, // enable on HTTPS
        maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      });
    }

    (req as any).guestSessionId = gid;
    next();
  };
}
