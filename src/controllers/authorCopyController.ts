import { PaymentMethod, Prisma, ShippingMethod } from "@prisma/client";
import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import prisma from "../utils/prisma";

const MAX_AUTHOR_COPIES = 100;

function parseBookId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseQuantity(value: unknown): number | null {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_AUTHOR_COPIES ? quantity : null;
}

function calculateQuote(book: any, quantity: number, shippingMethod: ShippingMethod) {
  // Temporary v1 server tariff. The client never supplies any of these amounts.
  let unitPrice = 149;
  if (book.design?.bindingType === "HARDCOVER") unitPrice += 150;
  if (book.design?.interior === "COLOR") unitPrice += 100;
  if (["EIGHT_HALF_X_EIGHT_HALF", "EIGHT_HALF_X_ELEVEN"].includes(book.design?.size)) unitPrice += 50;
  const shippingCharge = shippingMethod === "EXPRESS" ? 149 : 79;
  const subtotal = unitPrice * quantity;
  return {
    pricingVersion: "author-copy-v1",
    currency: "INR",
    quantity,
    unitPrice,
    subtotal,
    shippingCharge,
    tax: 0,
    total: subtotal + shippingCharge,
  };
}

async function getEligibleBook(bookId: number, userId: number) {
  return prisma.book.findFirst({
    where: { id: bookId, userId, status: "PUBLISHED", deletedAt: null },
    include: { design: true },
  });
}

export const quoteAuthorCopies = async (req: AuthRequest, res: Response) => {
  const bookId = parseBookId(req.params.id);
  const quantity = parseQuantity(req.body?.quantity);
  const shippingMethod: ShippingMethod = req.body?.shippingMethod === "EXPRESS" ? "EXPRESS" : "STANDARD";
  if (!bookId) return res.status(400).json({ message: "Invalid book id" });
  if (!quantity) return res.status(400).json({ message: `quantity must be between 1 and ${MAX_AUTHOR_COPIES}` });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const book = await getEligibleBook(bookId, req.userId);
    if (!book) return res.status(403).json({ message: "Author copies are available only to the owner of a published book" });
    return res.json({ book: { id: book.id, title: book.title }, quote: calculateQuote(book, quantity, shippingMethod) });
  } catch (error) {
    console.error("quoteAuthorCopies error:", error);
    return res.status(500).json({ message: "Failed to calculate author-copy quote" });
  }
};

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= max ? cleaned : null;
}

export const createAuthorCopyOrder = async (req: AuthRequest, res: Response) => {
  const bookId = parseBookId(req.params.id);
  const quantity = parseQuantity(req.body?.quantity);
  const shippingMethod: ShippingMethod = req.body?.shippingMethod === "EXPRESS" ? "EXPRESS" : "STANDARD";
  const paymentMethod: PaymentMethod = req.body?.paymentMethod === "CARD" ? "CARD" : "UPI";
  if (!bookId) return res.status(400).json({ message: "Invalid book id" });
  if (!quantity) return res.status(400).json({ message: `quantity must be between 1 and ${MAX_AUTHOR_COPIES}` });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });

  const delivery = req.body?.delivery ?? {};
  const details = {
    name: requiredText(delivery.name, 160),
    email: requiredText(delivery.email, 254),
    phone: requiredText(delivery.phone, 30),
    addressLine1: requiredText(delivery.addressLine1, 300),
    addressLine2: typeof delivery.addressLine2 === "string" ? delivery.addressLine2.trim().slice(0, 300) || null : null,
    city: requiredText(delivery.city, 120),
    state: requiredText(delivery.state, 120),
    postalCode: requiredText(delivery.postalCode, 20),
    country: requiredText(delivery.country, 120),
  };
  if (Object.entries(details).some(([key, value]) => key !== "addressLine2" && !value)) {
    return res.status(400).json({ message: "Complete delivery details are required" });
  }

  try {
    const book = await getEligibleBook(bookId, req.userId);
    if (!book) return res.status(403).json({ message: "Author copies are available only to the owner of a published book" });
    const quote = calculateQuote(book, quantity, shippingMethod);
    const order = await prisma.order.create({
      data: {
        userId: req.userId,
        kind: "AUTHOR_COPY",
        subtotal: new Prisma.Decimal(quote.subtotal),
        savings: new Prisma.Decimal(0),
        storePickup: new Prisma.Decimal(0),
        shippingCharge: new Prisma.Decimal(quote.shippingCharge),
        tax: new Prisma.Decimal(quote.tax),
        totalPrice: new Prisma.Decimal(quote.total),
        totalQty: quantity,
        paymentMethod,
        shippingMethod,
        customerName: details.name!,
        customerEmail: details.email!,
        customerPhone: details.phone!,
        addressLine1: details.addressLine1!,
        addressLine2: details.addressLine2,
        city: details.city!,
        state: details.state!,
        postalCode: details.postalCode!,
        country: details.country!,
        items: {
          create: {
            bookId,
            unitPrice: new Prisma.Decimal(quote.unitPrice),
            qty: quantity,
            lineTotal: new Prisma.Decimal(quote.subtotal),
          },
        },
        payments: {
          create: {
            userId: req.userId,
            amount: new Prisma.Decimal(quote.total),
            method: paymentMethod,
            status: "PENDING",
          },
        },
      },
      include: { items: true, payments: true },
    });
    return res.status(201).json({
      order,
      quote,
      message: "Author-copy order created. It remains pending until payment is verified.",
    });
  } catch (error) {
    console.error("createAuthorCopyOrder error:", error);
    return res.status(500).json({ message: "Failed to create author-copy order" });
  }
};
