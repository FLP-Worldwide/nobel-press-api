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

const router = Router();

router.get('/', getCartHandler);
router.post('/items', addItemHandler);
router.patch('/items/:id', updateItemQtyHandler);
router.delete('/items/:id', removeItemHandler);
router.delete('/', clearCartHandler);
router.post('/merge-guest', mergeGuestCartHandler);

export default router;
