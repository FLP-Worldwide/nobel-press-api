import { createHash, timingSafeEqual } from "crypto";
import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../utils/prisma";
import { verifyPayment } from "../services/paymentService";
import { serializable } from "../services/checkoutService";

// PhonePe SHA callbacks: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook
export const phonePeWebhook = async (req: Request, res: Response) => {
  const username = process.env.PHONEPE_WEBHOOK_USERNAME;
  const password = process.env.PHONEPE_WEBHOOK_PASSWORD;
  if (!username || !password) return res.status(503).json({ message: "Webhook is not configured" });
  const expected = createHash("sha256").update(`${username}:${password}`).digest("hex");
  const received = req.get("Authorization") || "";
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) {
    return res.status(401).json({ message: "Invalid webhook authorization" });
  }
  const event = req.body?.event;
  if (!["checkout.order.completed", "checkout.order.failed", "pg.refund.completed"].includes(event)) return res.json({ received: true });
  const payload = req.body?.payload;
  const refund = event === "pg.refund.completed";
  const providerOrderId = refund ? payload?.originalMerchantOrderId : payload?.merchantOrderId;
  if (typeof providerOrderId !== "string" || !providerOrderId || !payload ||
      !Number.isSafeInteger(payload.amount) || payload.amount <= 0 ||
      payload.state !== (event === "checkout.order.failed" ? "FAILED" : "COMPLETED")) {
    return res.status(400).json({ message: "Invalid webhook payload" });
  }
  try {
    const [review, order] = await Promise.all([
      prisma.publishingPayment.findUnique({ where: { providerOrderId } }),
      prisma.payment.findUnique({ where: { providerOrderId } }),
    ]);
    const payment = review || order;
    if (!payment) return res.json({ received: true });
    const flow = review ? "review" : "order";
    if (!refund) await verifyPayment(flow, payment.id, payload);
    else {
      if (!payload.refundId || payload.amount > new Prisma.Decimal(payment.amount).mul(100).toNumber()) {
        return res.status(400).json({ message: "Invalid refund amount or reference" });
      }
      // Reconcile an out-of-order refund callback before recording the refund.
      if (payment.status === "PENDING") await verifyPayment(flow, payment.id);
      await serializable(async tx => {
        const repository: any = review ? tx.publishingPayment : tx.payment;
        await repository.updateMany({ where: { id: payment.id, status: "PAID" }, data: {
          status: "REFUNDED", errorMessage: `PhonePe refund ${payload.refundId}: ${payload.amount} paise. Excluded from earnings and fulfilment.` } });
      });
    }
    return res.json({ received: true });
  } catch { return res.status(503).json({ message: "Webhook could not be applied. Retry delivery." }); }
};
