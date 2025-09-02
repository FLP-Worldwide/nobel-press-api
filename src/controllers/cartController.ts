// src/controllers/cartController.ts
import { Request, Response } from 'express';
import { addItem, clearCart, getCart, removeItem, updateItemQty } from '../services/cartService';
import { Principal } from '../types/principal';
import { AuthRequest } from '../middleware/authMiddleware';


export function principalFromReq(req: AuthRequest): Principal {
  if (req.userId != null) {
    return { userId: req.userId }; // ✅ Logged-in user
  }

  if (req.guestSessionId) {
    return { sessionId: req.guestSessionId }; // ✅ Guest session
  }

  throw new Error("No principal found");
}
export async function getCartHandler(req: Request, res: Response) {
  try { res.json(await getCart(principalFromReq(req))); }
  catch (e: any) { res.status(500).json({ message: e.message ?? 'Server error' }); }
}

export async function addItemHandler(req: Request, res: Response) {
  try {
    const p = principalFromReq(req);

    const { bookId, qty = 1, price } = req.body;
    if (!bookId || price == null) return res.status(400).json({ message: 'bookId and price are required' });
    res.status(201).json(await addItem(p, Number(bookId), Number(qty), price));
  } catch (e: any) { res.status(400).json({ message: e.message ?? 'Bad request' }); }
}

export async function updateItemQtyHandler(req: Request, res: Response) {
  try {
    const p = principalFromReq(req);
    const { id } = req.params; const { qty } = req.body;
    if (qty === undefined) return res.status(400).json({ message: 'qty is required' });
    res.json(await updateItemQty(p, Number(id), Number(qty)));
  } catch (e: any) { res.status(400).json({ message: e.message ?? 'Bad request' }); }
}

export async function removeItemHandler(req: Request, res: Response) {
  try {
    const p = principalFromReq(req);
    const { id } = req.params;
    res.json(await removeItem(p, Number(id)));
  } catch (e: any) { res.status(400).json({ message: e.message ?? 'Bad request' }); }
}

export async function clearCartHandler(req: Request, res: Response) {
  try { res.json(await clearCart(principalFromReq(req))); }
  catch (e: any) { res.status(400).json({ message: e.message ?? 'Bad request' }); }
}
