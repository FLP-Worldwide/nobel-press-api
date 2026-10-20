import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import prisma from "../utils/prisma";
import { REVIEW_FEE, startPayment, verifyPayment } from "../services/paymentService";
export const PUBLISHING_FEE = REVIEW_FEE;
export const initiatePublishingPayment = async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid book id" });
  try { return res.json({ ...await startPayment("review", id, req.userId!), publishingFee: REVIEW_FEE }); }
  catch (error: any) { return res.status(409).json({ message: error.code ? "Payment is temporarily unavailable" : error.message }); }
};
export const getPublishingPaymentStatus = async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid book id" });
  try {
    const book = await prisma.book.findFirst({ where: { id, deletedAt: null } });
    if (!book || (req.role !== "admin" && book.userId !== req.userId)) return res.status(404).json({ message: "Book not found" });
    let payment = await prisma.publishingPayment.findFirst({ where: { bookId: id }, orderBy: { id: "desc" } });
    if (payment) payment = await verifyPayment("review", payment.id);
    const fresh = await prisma.book.findUniqueOrThrow({ where: { id } });
    return res.json({ bookId: id, bookPublicId: fresh.publicId, bookStatus: fresh.status, payment, publishingFee: REVIEW_FEE, verification: payment?.status === "PAID" ? "verified" : "not_verified" });
  } catch { return res.status(502).json({ message: "Payment could not be verified. Please check again before retrying payment." }); }
};
