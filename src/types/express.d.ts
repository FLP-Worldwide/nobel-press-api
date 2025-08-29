// src/types/express.d.ts
import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: number; [k: string]: any }; // set by your auth
    guestSessionId?: string;                  // set by guestSession middleware
  }
}
