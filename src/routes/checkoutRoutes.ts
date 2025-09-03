import { Router } from "express";
import { checkoutController } from "../controllers/checkoutController";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

// POST /api/checkout
router.post("/", authMiddleware, checkoutController.createOrder);

export default router;
