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

      const requiredDelivery = ["name", "email", "phone", "addressLine1", "city", "state", "postalCode", "country"];
      if (!delivery || requiredDelivery.some((field) => typeof delivery[field] !== "string" || !delivery[field].trim())) {
        return res.status(400).json({ success: false, message: "Complete delivery details are required" });
      }
      if (!["CARD", "UPI"].includes(paymentMethod)) {
        return res.status(400).json({ success: false, message: "A supported online payment method is required" });
      }
      if (!["STANDARD", "EXPRESS"].includes(shippingMethod)) {
        return res.status(400).json({ success: false, message: "Invalid shipping method" });
      }

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
      res.status(400).json({
        success: false,
        message: "Checkout failed",
        error: error.message,
      });
    }
  },
};
