import { Request, Response } from "express";
import * as checkoutService from "../services/checkoutService";
import { AuthRequest } from "../middleware/authMiddleware";
export const checkoutController = {
  async createOrder(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { delivery, paymentMethod, shippingMethod } = req.body;

      const order = await checkoutService.createOrder({
        userId: req.userId,   // ✅ अब userId पास होगा
        delivery,
        paymentMethod,
        shippingMethod,
      });

      res.status(201).json({
        success: true,
        message: "Order placed successfully",
        order,
      });
    } catch (error: any) {
      console.error("Checkout error:", error);
      res.status(500).json({
        success: false,
        message: "Checkout failed",
        error: error.message,
      });
    }
  },
};
