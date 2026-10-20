import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import prisma from "../utils/prisma";
import { getBookPricing, money } from "../utils/commerce";
import { serializable } from "../services/checkoutService";

export const getPricing = async (req: AuthRequest, res: Response) => {
  try {
    const book = await prisma.book.findFirst({ where: { id: Number(req.params.id), userId: req.userId, deletedAt: null } });
    if (!book) return res.status(404).json({ message: "Book not found" });
    const paid = await prisma.publishingPayment.count({ where: { bookId: book.id, status: "PAID", amount: 199, currency: "INR" } });
    return res.json({ pricing: getBookPricing(book), canPublish: book.status === "APPROVED" && (paid > 0 || Boolean(book.reviewFeeWaivedAt)) });
  } catch (error: any) { return res.status(400).json({ message: error.code ? "Pricing is unavailable" : error.message }); }
};

export const publishBook = async (req: AuthRequest, res: Response) => {
  try {
    const price = money(req.body?.retailPrice);
    const book = await serializable(async tx => {
      const book = await tx.book.findFirst({ where: { id: Number(req.params.id), userId: req.userId, deletedAt: null } });
      if (!book || !["APPROVED", "PUBLISHED"].includes(book.status)) throw new Error("An approved book is required");
      const review = await tx.bookReview.findFirst({ where: { bookId: book.id }, orderBy: { submittedAt: "desc" } });
      const paid = await tx.publishingPayment.findFirst({ where: { bookId: book.id, status: "PAID", amount: 199, currency: "INR" } });
      if ((!paid && !book.reviewFeeWaivedAt) || review?.status !== "APPROVED") throw new Error("Review fee clearance and editorial approval are required");
      if (price.lt(getBookPricing(book).minimumSellingPrice)) throw new Error("Selling price must cover discounted author-copy printing costs");
      if (book.status === "PUBLISHED") {
        if (book.retailPrice?.equals(price)) return book;
        throw new Error("Start a revision before changing a published book");
      }
      const result = await tx.book.update({ where: { id: book.id }, data: { retailPrice: price, status: "PUBLISHED", publishedAt: new Date() } });
      await tx.bookStatusEvent.create({ data: { bookId: book.id, actorId: req.userId!, previousStatus: "APPROVED", newStatus: "PUBLISHED", notes: "Author confirmed selling price and publication" } });
      return result;
    });
    return res.json({ book });
  } catch (error: any) { return res.status(409).json({ message: error.code ? "Publication is temporarily unavailable" : error.message }); }
};
