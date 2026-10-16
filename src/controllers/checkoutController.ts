import { Response } from "express";
import * as checkoutService from "../services/checkoutService";
import { AuthRequest } from "../middleware/authMiddleware";

export const checkoutController = {
  async createOrder(req: AuthRequest, res: Response) {
    if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
    try {
      const { paymentMethod, shippingMethod } = req.body || {};
      const delivery = checkoutService.validateDelivery(req.body?.delivery);
      if (!["CARD", "UPI"].includes(paymentMethod)) throw new Error("A supported online payment method is required");
      if (!["STANDARD", "EXPRESS"].includes(shippingMethod)) throw new Error("Invalid shipping method");
      const checkoutKey = checkoutService.scopedCheckoutKey(req.get("Idempotency-Key") || req.body?.checkoutKey, req.userId, "RETAIL");
      const order = await checkoutService.createOrder({ userId: req.userId, delivery, paymentMethod, shippingMethod, checkoutKey });
      return res.status(201).json({ success: true, message: "Order reserved. Complete payment to place your order.", order });
    } catch (error: any) {
      if (error?.code) {
        console.error("Checkout error:", error.code);
        return res.status(503).json({ message: "Checkout is temporarily unavailable. Please try again." });
      }
      return res.status(400).json({ success: false, message: error.message || "Checkout failed" });
    }
  },
};
