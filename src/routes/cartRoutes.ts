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
router.patch('/items/:id', updateItemQtyHandler);
router.delete('/items/:id', removeItemHandler);
router.delete('/', clearCartHandler);
router.post('/merge-guest', mergeGuestCartHandler);

export default router;
