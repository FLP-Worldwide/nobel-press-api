import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../utils/prisma";
import { serializable } from "./checkoutService";
import { getPhonePeOrderStatus, PhonePeOrderStatus } from "../utils/getPhonePeOrderStatus";
import { initiatePhonePePayment } from "../utils/initiatePhonePePayment";

type Flow = "review" | "order";
export const REVIEW_FEE = { amount: 199, amountPaise: 19900, currency: "INR" } as const;
const model = (tx: any, flow: Flow): any => flow === "review" ? tx.publishingPayment : tx.payment;
export function gatewayConfigured() {
  return Boolean(process.env.PHONEPE_BASE_URL && process.env.PHONEPE_CLIENT_ID && process.env.PHONEPE_CLIENT_SECRET &&
    (process.env.PAYMENT_REDIRECT_URL || process.env.PUBLISHING_PAYMENT_REDIRECT_URL));
}
function redirectUrl(flow: Flow, id: number) {
  const url = new URL(process.env.PAYMENT_REDIRECT_URL || process.env.PUBLISHING_PAYMENT_REDIRECT_URL!);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid payment redirect configuration");
  url.search = "";
  url.searchParams.set("flow", flow === "review" ? "publishing" : "order");
  url.searchParams.set(flow === "review" ? "publishingBookId" : "orderId", String(id));
  return url.toString();
}

// verifiedStatus is accepted only from the authenticated PhonePe webhook.
export async function verifyPayment(flow: Flow, paymentId: number, verifiedStatus?: PhonePeOrderStatus) {
  const payment = await model(prisma, flow).findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== "PENDING" || !payment.providerOrderId) return payment;
  const status = verifiedStatus || await getPhonePeOrderStatus(payment.providerOrderId);
  if (!["COMPLETED", "FAILED"].includes(status.state)) return payment;
  const expected = new Prisma.Decimal(payment.amount).mul(100).toNumber();
  if (status.state === "COMPLETED" && (Number(status.amount) !== expected || payment.currency !== "INR")) {
    // Keep ambiguous payments pending: a mismatch must never unlock another charge.
    throw new Error("Payment amount could not be verified. Contact support before retrying.");
  }
  return serializable(async tx => {
    const current = await model(tx, flow).findUnique({ where: { id: paymentId } });
    if (current.status !== "PENDING") return current;
    if (status.state === "FAILED") return model(tx, flow).update({ where: { id: paymentId }, data: {
      status: "FAILED", errorMessage: status.detailedErrorCode || status.errorCode || "Payment failed" } });
    const providerRef = status.paymentDetails?.find(p => p.state === "COMPLETED")?.transactionId || status.orderId;
    if (!providerRef) throw new Error("Provider transaction reference is missing");
    if (flow === "review") {
      const review = await tx.bookReview.findUnique({ where: { revisionId: current.revisionId } });
      if (!review || review.status !== "PAYMENT_PENDING") throw new Error("Submission state changed; contact support");
      const changed = await tx.book.updateMany({ where: { id: current.bookId, status: "PAYMENT_PENDING", deletedAt: null }, data: { status: "IN_REVIEW" } });
      if (changed.count !== 1) throw new Error("Submission state changed; contact support");
      await tx.bookReview.update({ where: { id: review.id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
      await tx.bookStatusEvent.create({ data: { bookId: current.bookId, actorId: current.userId,
        previousStatus: "PAYMENT_PENDING", newStatus: "IN_REVIEW", notes: "One-time review fee verified by PhonePe" } });
    } else {
      const order = await tx.order.findUniqueOrThrow({ where: { id: current.orderId }, include: { items: true } });
      if (order.status !== "PENDING" || !order.totalPrice.equals(current.amount)) throw new Error("Order state changed; contact support");
      await tx.order.update({ where: { id: order.id }, data: { status: "PAID" } });
      // Clear only the exact cart rows bought; preserve anything changed during payment.
      for (const item of order.items) if (item.cartItemId && item.cartItemUpdatedAt) {
        await tx.cartItem.deleteMany({ where: { id: item.cartItemId, updatedAt: item.cartItemUpdatedAt, cart: { userId: order.userId } } });
      }
      const cart = await tx.cart.findUnique({ where: { userId: order.userId }, include: { items: true } });
      if (cart) await tx.cart.update({ where: { id: cart.id }, data: {
        totalQty: cart.items.reduce((n, item) => n + item.qty, 0),
        totalPrice: cart.items.reduce((n, item) => n.plus(item.price.mul(item.qty)), new Prisma.Decimal(0)) } });
    }
    return model(tx, flow).update({ where: { id: paymentId }, data: { status: "PAID", providerRef, paidAt: new Date(), errorMessage: null } });
  });
}

export async function startPayment(flow: Flow, id: number, userId: number) {
  if (!gatewayConfigured()) throw new Error("Online payment is not configured. No charge was made.");
  const returnUrl = redirectUrl(flow, id);
  // Verify the previous attempt before deciding whether another one is allowed.
  const previous = await model(prisma, flow).findFirst({ where: flow === "review" ? { bookId: id, userId } : { orderId: id, userId }, orderBy: { id: "desc" } });
  if (previous?.status === "PENDING" && previous.providerOrderId) await verifyPayment(flow, previous.id);
  const reservation = await serializable(async tx => {
    let amount: Prisma.Decimal;
    let revisionId: number | undefined;
    let method: any;
    if (flow === "review") {
      const book = await tx.book.findFirst({ where: { id, userId, deletedAt: null } });
      if (!book || book.status !== "PAYMENT_PENDING") throw new Error("This book is not awaiting review payment");
      const review = await tx.bookReview.findFirst({ where: { bookId: id }, orderBy: { submittedAt: "desc" } });
      if (review?.status !== "PAYMENT_PENDING") throw new Error("No submitted revision awaiting payment");
      revisionId = review.revisionId; amount = new Prisma.Decimal(199);
    } else {
      const order = await tx.order.findFirst({ where: { id, userId } });
      if (!order) throw new Error("Order not found");
      if (order.status !== "PENDING") throw new Error("This order is not awaiting payment");
      amount = order.totalPrice; method = order.paymentMethod;
    }
    const where = flow === "review" ? { bookId: id } : { orderId: id };
    const paid = await model(tx, flow).findFirst({ where: { ...where, status: { in: ["PAID", "REFUNDED"] } } });
    if (paid) throw new Error("This payment has already been processed");
    let payment = await model(tx, flow).findFirst({ where: { ...where, status: "PENDING" }, orderBy: { id: "desc" } });
    if (payment?.providerOrderId) return { payment, start: false };
    const data = { userId, amount, currency: "INR", provider: "PHONEPE", providerOrderId: `${flow === "review" ? "REV" : "ORD"}-${randomUUID()}`, initiationStartedAt: new Date() };
    if (payment) payment = await model(tx, flow).update({ where: { id: payment.id }, data });
    else payment = await model(tx, flow).create({ data: { ...data, ...(flow === "review" ? { bookId: id, revisionId } : { orderId: id, method }) } });
    return { payment, start: true };
  });
  let payment = reservation.payment;
  if (reservation.start) {
    const result = await initiatePhonePePayment({ merchantOrderId: payment.providerOrderId,
      amount: new Prisma.Decimal(payment.amount).mul(100).toNumber(), redirectUrl: returnUrl,
      message: flow === "review" ? "Book review fee" : `Book order ${id}` });
    // Network errors are ambiguous. Retain the provider ID until verified FAILED.
    await model(prisma, flow).updateMany({ where: { id: payment.id, status: "PENDING" }, data: result.success ?
      { redirectUrl: result.redirectUrl, errorMessage: null } : { errorMessage: "Payment initiation was not confirmed. Check payment status before retrying." } });
    payment = await model(prisma, flow).findUnique({ where: { id: payment.id } });
  }
  return { payment, gateway: { available: true, redirectUrl: payment.status === "PENDING" ? payment.redirectUrl : null,
    message: payment.redirectUrl ? undefined : "Payment is being verified. Check status before retrying." } };
}
