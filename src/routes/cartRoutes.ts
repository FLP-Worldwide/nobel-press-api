// src/routes/cartRoutes.ts
import { Router } from 'express';
import {
  addItemHandler,
  clearCartHandler,
  getCartHandler,
  removeItemHandler,
  updateItemQtyHandler,
} from '../controllers/cartController';
import { mergeGuestCartHandler } from '../controllers/cartMergeController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.get('/', authMiddleware,getCartHandler);
router.post('/items',authMiddleware, addItemHandler);
router.patch('/items/:id', authMiddleware, updateItemQtyHandler);
router.delete('/items/:id', authMiddleware, removeItemHandler);
router.delete('/', authMiddleware, clearCartHandler);
router.post('/merge-guest', authMiddleware, mergeGuestCartHandler);

export default router;
