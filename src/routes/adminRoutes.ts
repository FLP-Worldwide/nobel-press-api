import { Router } from "express";
import { PaymentStatus, PublishingFeeStatus } from "@prisma/client";
import { authMiddleware, roleMiddleware } from "../middleware/authMiddleware";
import prisma from "../utils/prisma";
import { verifyPayment } from "../services/paymentService";

const router = Router();
router.use(authMiddleware, roleMiddleware("admin"));
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

const paymentSelect = {
  id: true, amount: true, currency: true, status: true, provider: true,
  providerRef: true, providerOrderId: true, paidAt: true, createdAt: true,
  user: { select: { name: true, email: true } },
} as const;

router.get("/payments", async (req, res) => {
  const flow = req.query.flow || "order";
  const status = req.query.status || "ALL";
  const page = Number(req.query.page || 1);
  if (!["order", "review"].includes(String(flow)) || !["ALL", ...Object.values(PaymentStatus)].includes(String(status)) ||
      !Number.isSafeInteger(page) || page < 1 || page > 100000) {
    return res.status(400).json({ message: "Invalid payment filters" });
  }
  try {
    const take = 25;
    if (flow === "review") {
      const where = status === "ALL" ? {} : { status: status as PublishingFeeStatus };
      const [payments, total, summary] = await prisma.$transaction([
        prisma.publishingPayment.findMany({ where, select: { ...paymentSelect, bookId: true, book: { select: { title: true } } }, orderBy: { id: "desc" }, skip: (page - 1) * take, take }),
        prisma.publishingPayment.count({ where }),
        prisma.publishingPayment.groupBy({ by: ["status", "currency"], orderBy: { status: "asc" }, _sum: { amount: true }, _count: { _all: true } }),
      ]);
      return res.json({ payments, total, page, pageSize: take, summary });
    }
    const where = status === "ALL" ? {} : { status: status as PaymentStatus };
    const [payments, total, summary] = await prisma.$transaction([
      prisma.payment.findMany({ where, select: { ...paymentSelect, orderId: true, order: { select: { kind: true, status: true } } }, orderBy: { id: "desc" }, skip: (page - 1) * take, take }),
      prisma.payment.count({ where }),
      prisma.payment.groupBy({ by: ["status", "currency"], orderBy: { status: "asc" }, _sum: { amount: true }, _count: { _all: true } }),
    ]);
    return res.json({ payments, total, page, pageSize: take, summary });
  } catch { return res.status(503).json({ message: "Payments are temporarily unavailable" }); }
});

// Reconcile an existing attempt with the provider. Staff cannot mark it paid or create a charge.
router.post("/payments/:flow/:id/verify", async (req, res) => {
  const flow = req.params.flow;
  const id = Number(req.params.id);
  if ((flow !== "order" && flow !== "review") || !Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Invalid payment reference" });
  }
  try {
    const payment = await verifyPayment(flow, id);
    if (!payment) return res.status(404).json({ message: "Payment not found" });
    return res.json({ payment: { id: payment.id, status: payment.status } });
  } catch { return res.status(502).json({ message: "Provider verification is unavailable or the amount could not be verified. Check again before retrying payment." }); }
});

export default router;
