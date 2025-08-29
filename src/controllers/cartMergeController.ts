// src/controllers/cartMergeController.ts
import { Request, Response } from 'express';
import { mergeGuestCartToUser } from '../services/cartService';

export async function mergeGuestCartHandler(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const sessionId = req.guestSessionId;
    if (!sessionId) return res.json({ merged: false });
    const cart = await mergeGuestCartToUser(sessionId, userId);
    res.json({ merged: !!cart, cart });
  } catch (e: any) {
    res.status(400).json({ message: e.message ?? 'Merge failed' });
  }
}
