import { Router } from "express";
import { getMyOrders, getOrderById } from "../controllers/orderController";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();
router.use(authMiddleware);
router.get("/my", getMyOrders);
router.get("/:id", getOrderById);

export default router;
