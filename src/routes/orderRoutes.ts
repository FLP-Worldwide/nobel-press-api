import { Router } from "express";
import { getMyOrders, getOrderById } from "../controllers/orderController";
import { authMiddleware, roleMiddleware } from "../middleware/authMiddleware";

import { initiateOrderPayment, getOrderPaymentStatus } from "../controllers/orderPaymentController";
import { listFulfilment, updateFulfilment, getOrderProof } from "../controllers/fulfilmentController";
const router = Router();
router.use(authMiddleware);
router.get("/my", getMyOrders);
router.get("/fulfilment", roleMiddleware("admin"), listFulfilment);
router.patch("/:id/fulfilment", roleMiddleware("admin"), updateFulfilment);
router.get("/:id/items/:itemId/proof", roleMiddleware("admin"), getOrderProof);
router.post("/:id/payment/initiate", initiateOrderPayment);
router.get("/:id/payment/status", getOrderPaymentStatus);
router.get("/:id", getOrderById);

export default router;
