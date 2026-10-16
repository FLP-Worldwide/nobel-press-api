import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import prisma from "../utils/prisma";
import { startPayment, verifyPayment } from "../services/paymentService";
export const initiateOrderPayment = async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid order id" });
  try { return res.json(await startPayment("order", id, req.userId!)); }
  catch (error: any) { return res.status(409).json({ message: error.code ? "Payment is temporarily unavailable" : error.message }); }
};
export const getOrderPaymentStatus = async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid order id" });
  try {
    const order = await prisma.order.findFirst({ where: { id, ...(req.role === "admin" ? {} : { userId: req.userId }) } });
    if (!order) return res.status(404).json({ message: "Order not found" });
    let payment = await prisma.payment.findFirst({ where: { orderId: id }, orderBy: { id: "desc" } });
    if (payment) payment = await verifyPayment("order", payment.id);
    return res.json({ payment, order: await prisma.order.findUnique({ where: { id }, include: { items: true } }) });
  } catch { return res.status(502).json({ message: "Payment could not be verified. Please check again before retrying payment." }); }
};
