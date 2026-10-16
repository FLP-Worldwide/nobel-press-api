import { PaymentMethod, Prisma, ShippingMethod } from "@prisma/client";
import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import prisma from "../utils/prisma";
import { calculateOrderLine, getBookPricing } from "../utils/commerce";
import { assertSameCheckout, deliverySnapshot, scopedCheckoutKey, serializable, validateDelivery } from "../services/checkoutService";

const MAX_AUTHOR_COPIES = 100;
function parseBookId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
function parseQuantity(value: unknown): number | null {
  const quantity = Number(value);
  return typeof value !== "boolean" && Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_AUTHOR_COPIES ? quantity : null;
}
function calculateQuote(book: any, quantity: number, shippingMethod: ShippingMethod) {
  const pricing = getBookPricing(book);
  if (quantity < pricing.authorCopyMinQty) throw new Error(`Order at least ${pricing.authorCopyMinQty} author copies`);
  const item = calculateOrderLine(book, quantity, "AUTHOR_COPY");
  const shippingCharge = shippingMethod === "EXPRESS" ? 149 : 79;
  return { pricingVersion: "author-copy-v2", currency: "INR", quantity, minimumQuantity: pricing.authorCopyMinQty,
    discountPercent: pricing.authorCopyDiscountPercent, retailPrice: pricing.retailPrice, unitPrice: item.unitPrice,
    subtotal: item.lineTotal, shippingCharge, tax: 0,
    total: new Prisma.Decimal(item.lineTotal).plus(shippingCharge).toNumber() };
}
const eligibleBookWhere = (bookId: number, userId: number) => ({ id: bookId, userId, status: "PUBLISHED" as const, deletedAt: null });

export const quoteAuthorCopies = async (req: AuthRequest, res: Response) => {
  const bookId = parseBookId(req.params.id);
  const quantity = parseQuantity(req.body?.quantity);
  const shippingMethod = req.body?.shippingMethod || "STANDARD";
  if (!bookId) return res.status(400).json({ message: "Invalid book id" });
  if (!quantity) return res.status(400).json({ message: `quantity must be an integer between 1 and ${MAX_AUTHOR_COPIES}` });
  if (!["STANDARD", "EXPRESS"].includes(shippingMethod)) return res.status(400).json({ message: "Invalid shipping method" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const book = await prisma.book.findFirst({ where: eligibleBookWhere(bookId, req.userId) });
    if (!book) return res.status(403).json({ message: "Author copies are available only to the owner of a published book" });
    return res.json({ book: { id: book.id, title: book.title }, quote: calculateQuote(book, quantity, shippingMethod) });
  } catch (error: any) {
    return res.status(error?.code ? 503 : 400).json({ message: error?.code ? "Quote is temporarily unavailable" : error.message });
  }
};

export const createAuthorCopyOrder = async (req: AuthRequest, res: Response) => {
  const bookId = parseBookId(req.params.id);
  const quantity = parseQuantity(req.body?.quantity);
  const shippingMethod: ShippingMethod = req.body?.shippingMethod || "STANDARD";
  const paymentMethod: PaymentMethod = req.body?.paymentMethod || "UPI";
  if (!bookId) return res.status(400).json({ message: "Invalid book id" });
  if (!quantity) return res.status(400).json({ message: `quantity must be an integer between 1 and ${MAX_AUTHOR_COPIES}` });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  if (!["STANDARD", "EXPRESS"].includes(shippingMethod) || !["CARD", "UPI"].includes(paymentMethod)) {
    return res.status(400).json({ message: "Invalid shipping or payment method" });
  }
  try {
    const userId = req.userId;
    const delivery = validateDelivery(req.body?.delivery);
    const checkoutKey = scopedCheckoutKey(req.get("Idempotency-Key") || req.body?.checkoutKey, userId, "AUTHOR_COPY");
    const order = await serializable(async tx => {
      const existing = await tx.order.findUnique({ where: { checkoutKey }, include: { items: true, payments: true } });
      if (existing) {
        if (existing.userId !== userId || existing.kind !== "AUTHOR_COPY" || existing.items.length !== 1 ||
            existing.items[0].bookId !== bookId || existing.items[0].qty !== quantity) throw new Error("Checkout details changed. Start a new checkout.");
        assertSameCheckout(existing, delivery, paymentMethod, shippingMethod);
        return existing;
      }
      const book = await tx.book.findFirst({ where: eligibleBookWhere(bookId, userId), include: {
        reviews: { where: { status: "APPROVED" }, orderBy: { reviewedAt: "desc" }, take: 1 },
      } });
      if (!book || !book.reviews[0]) throw new Error("Author copies are available only to the owner of a published book");
      const quote = calculateQuote(book, quantity, shippingMethod);
      const item = calculateOrderLine(book, quantity, "AUTHOR_COPY");
      return tx.order.create({
        data: {
          userId, checkoutKey, kind: "AUTHOR_COPY", currency: "INR", subtotal: quote.subtotal,
          savings: new Prisma.Decimal(book.retailPrice!).mul(quantity).minus(quote.subtotal), storePickup: 0,
          shippingCharge: quote.shippingCharge, tax: quote.tax, totalPrice: quote.total, totalQty: quantity,
          paymentMethod, shippingMethod, ...deliverySnapshot(delivery),
          items: { create: { bookId, qty: quantity, ...item, revisionId: book.reviews[0].revisionId } },
          payments: { create: { userId, amount: quote.total, method: paymentMethod, status: "PENDING", currency: "INR" } },
        }, include: { items: true, payments: true },
      });
    });
    return res.status(201).json({ order, message: "Author-copy order reserved. Complete payment to place your order." });
  } catch (error: any) {
    return res.status(error?.code ? 503 : 400).json({ message: error?.code ? "Checkout is temporarily unavailable" : error.message });
  }
};
