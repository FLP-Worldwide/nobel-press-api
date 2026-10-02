import { Prisma } from "@prisma/client";
import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import prisma from "../utils/prisma";
import { getPhonePeOrderStatus } from "../utils/getPhonePeOrderStatus";
import { initiatePhonePePayment } from "../utils/initiatePhonePePayment";

export const PUBLISHING_FEE = {
  amount: 199,
  amountPaise: 19900,
  currency: "INR",
} as const;

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function phonePeConfigured(): boolean {
  return Boolean(
    process.env.PHONEPE_BASE_URL &&
    process.env.PHONEPE_CLIENT_ID &&
    process.env.PHONEPE_CLIENT_SECRET &&
    process.env.PUBLISHING_PAYMENT_REDIRECT_URL,
  );
}

function phonePeCredentialsConfigured(): boolean {
  return Boolean(
    process.env.PHONEPE_BASE_URL &&
    process.env.PHONEPE_CLIENT_ID &&
    process.env.PHONEPE_CLIENT_SECRET,
  );
}

function publishingRedirectUrl(bookId: number): string {
  const redirect = new URL(process.env.PUBLISHING_PAYMENT_REDIRECT_URL!);
  redirect.searchParams.set("flow", "publishing");
  redirect.searchParams.set("publishingBookId", String(bookId));
  return redirect.toString();
}

export const initiatePublishingPayment = async (req: AuthRequest, res: Response) => {
  const bookId = parseId(req.params.id);
  if (!bookId) return res.status(400).json({ message: "Invalid book id" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const book = await prisma.book.findFirst({ where: { id: bookId, deletedAt: null } });
    if (!book) return res.status(404).json({ message: "Book not found" });
    if (book.userId !== req.userId) return res.status(403).json({ message: "Forbidden" });
    if (!["APPROVED", "PAYMENT_PENDING"].includes(book.status)) {
      return res.status(409).json({ message: "The publishing fee is available only after approval" });
    }
    const paidFee = await prisma.publishingPayment.findFirst({ where: { bookId, status: "PAID", amount: 199, currency: "INR" } });
    if (paidFee) return res.status(409).json({ message: "The one-time publishing fee is already paid. This revision needs review only." });
    const approvedReview = await prisma.bookReview.findFirst({
      where: { bookId, status: "APPROVED" },
      orderBy: { reviewedAt: "desc" },
    });
    if (!approvedReview) return res.status(409).json({ message: "No approved revision was found" });

    const existing = await prisma.publishingPayment.findFirst({
      where: { bookId, revisionId: approvedReview.revisionId, status: { in: ["PENDING", "PAID"] } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      return res.json({
        payment: existing,
        publishingFee: PUBLISHING_FEE,
        gateway: {
          available: phonePeConfigured(),
          redirectUrl: null,
          message: existing.status === "PENDING" ? "Payment verification is still pending" : undefined,
        },
      });
    }

    if (!phonePeConfigured()) {
      return res.status(503).json({
        message: "Online publishing payment is not configured. No charge was made.",
        publishingFee: PUBLISHING_FEE,
        gateway: { available: false, redirectUrl: null },
      });
    }

    const providerOrderId = `PUB-${bookId}-${approvedReview.revisionId}-${Date.now()}`;
    const previousStatus = book.status;
    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.publishingPayment.create({
        data: {
          bookId,
          revisionId: approvedReview.revisionId,
          userId: req.userId!,
          amount: new Prisma.Decimal(PUBLISHING_FEE.amount),
          currency: PUBLISHING_FEE.currency,
          provider: "PHONEPE",
          providerOrderId,
        },
      });
      if (book.status !== "PAYMENT_PENDING") {
        const transitioned = await tx.book.updateMany({
          where: { id: bookId, status: "APPROVED" },
          data: { status: "PAYMENT_PENDING" },
        });
        if (transitioned.count !== 1) throw new Error("STATE_CHANGED");
        await tx.bookStatusEvent.create({
          data: {
            bookId,
            actorId: req.userId!,
            previousStatus,
            newStatus: "PAYMENT_PENDING",
            notes: "Publishing fee payment initiated",
          },
        });
      }
      return created;
    });

    const gatewayResult = await initiatePhonePePayment({
      merchantOrderId: providerOrderId,
      amount: PUBLISHING_FEE.amountPaise,
      redirectUrl: publishingRedirectUrl(bookId),
      message: `Publishing fee for book ${bookId}`,
    });
    if (!gatewayResult.success || !gatewayResult.redirectUrl) {
      await prisma.$transaction([
        prisma.publishingPayment.update({
          where: { id: payment.id },
          data: { status: "FAILED", errorMessage: gatewayResult.error ?? "PhonePe initiation failed" },
        }),
        prisma.book.update({ where: { id: bookId }, data: { status: "APPROVED" } }),
        prisma.bookStatusEvent.create({
          data: {
            bookId,
            actorId: req.userId,
            previousStatus: "PAYMENT_PENDING",
            newStatus: "APPROVED",
            notes: "Payment initiation failed",
          },
        }),
      ]);
      return res.status(502).json({
        message: "PhonePe could not start the payment",
        publishingFee: PUBLISHING_FEE,
      });
    }

    return res.status(201).json({
      payment,
      publishingFee: PUBLISHING_FEE,
      gateway: { available: true, redirectUrl: gatewayResult.redirectUrl },
    });
  } catch (error: any) {
    if (error?.message === "STATE_CHANGED") {
      return res.status(409).json({ message: "The book state changed. Refresh and try again." });
    }
    console.error("initiatePublishingPayment error:", error);
    return res.status(500).json({ message: "Failed to initiate publishing payment" });
  }
};

export const getPublishingPaymentStatus = async (req: AuthRequest, res: Response) => {
  const bookId = parseId(req.params.id);
  if (!bookId) return res.status(400).json({ message: "Invalid book id" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const book = await prisma.book.findFirst({ where: { id: bookId, deletedAt: null } });
    if (!book) return res.status(404).json({ message: "Book not found" });
    if (req.role !== "admin" && book.userId !== req.userId) return res.status(403).json({ message: "Forbidden" });
    let payment = await prisma.publishingPayment.findFirst({
      where: { bookId },
      orderBy: { createdAt: "desc" },
    });

    if (
      payment?.status === "PENDING" &&
      payment.provider === "PHONEPE" &&
      payment.providerOrderId &&
      phonePeCredentialsConfigured()
    ) {
      const providerStatus = await getPhonePeOrderStatus(payment.providerOrderId);
      const providerAmount = Number(providerStatus.amount);

      if (providerStatus.state === "COMPLETED") {
        if (providerAmount !== PUBLISHING_FEE.amountPaise) {
          await prisma.publishingPayment.update({
            where: { id: payment.id },
            data: {
              status: "FAILED",
              errorMessage: `Provider amount mismatch: expected ${PUBLISHING_FEE.amountPaise} paise`,
            },
          });
          return res.status(409).json({ message: "The payment amount could not be verified" });
        }

        const completedAttempt = providerStatus.paymentDetails?.find((attempt) => attempt.state === "COMPLETED");
        const providerRef = completedAttempt?.transactionId || providerStatus.orderId || payment.providerOrderId;
        await prisma.$transaction(async (tx) => {
          const paid = await tx.publishingPayment.updateMany({
            where: { id: payment!.id, status: "PENDING" },
            data: { status: "PAID", providerRef, paidAt: new Date(), errorMessage: null },
          });
          if (paid.count === 0) return;
          const published = await tx.book.updateMany({
            where: { id: bookId, status: "PAYMENT_PENDING" },
            data: { status: "PUBLISHED", publishedAt: new Date() },
          });
          if (published.count !== 1) throw new Error("STATE_CHANGED");
          await tx.bookStatusEvent.create({
            data: {
              bookId,
              actorId: payment!.userId,
              previousStatus: "PAYMENT_PENDING",
              newStatus: "PUBLISHED",
              notes: `Publishing fee verified by PhonePe (${providerRef})`,
            },
          });
        });
      } else if (providerStatus.state === "FAILED") {
        await prisma.$transaction(async (tx) => {
          const failed = await tx.publishingPayment.updateMany({
            where: { id: payment!.id, status: "PENDING" },
            data: {
              status: "FAILED",
              errorMessage: providerStatus.detailedErrorCode || providerStatus.errorCode || "Payment failed",
            },
          });
          if (failed.count === 0) return;
          const restored = await tx.book.updateMany({
            where: { id: bookId, status: "PAYMENT_PENDING" },
            data: { status: "APPROVED" },
          });
          if (restored.count === 1) {
            await tx.bookStatusEvent.create({
              data: {
                bookId,
                actorId: payment!.userId,
                previousStatus: "PAYMENT_PENDING",
                newStatus: "APPROVED",
                notes: "PhonePe reported that the publishing payment failed",
              },
            });
          }
        });
      }

      payment = await prisma.publishingPayment.findUnique({ where: { id: payment.id } });
    }

    const refreshedBook = await prisma.book.findUnique({ where: { id: bookId }, select: { status: true } });
    return res.json({
      bookId,
      bookStatus: refreshedBook?.status || book.status,
      payment,
      publishingFee: PUBLISHING_FEE,
      verification: payment?.status === "PAID" ? "verified" : "not_verified",
    });
  } catch (error: any) {
    if (error?.message === "STATE_CHANGED") {
      return res.status(409).json({ message: "The book state changed while payment was being verified" });
    }
    console.error("getPublishingPaymentStatus error:", error);
    return res.status(502).json({ message: "Payment status could not be verified. Please try again." });
  }
};
