import { serializable } from "./checkoutService";

// Temporary launch policy requested by the publisher. Set this server-only
// variable to "live" to collect review fees for new books again.
export function reviewPaymentsAreDemo() {
  return (process.env.REVIEW_PAYMENT_MODE || "demo").trim().toLowerCase() === "demo";
}

export function reviewFeePolicy(book?: { reviewFeeWaivedAt?: Date | null }) {
  const waived = Boolean(book?.reviewFeeWaivedAt);
  const demo = reviewPaymentsAreDemo();
  return { amount: 199, amountPaise: 19900, currency: "INR",
    mode: demo ? "demo" : "live", waived, required: !demo && !waived };
}

// Existing submissions may already be waiting for payment. A separate POST
// advances those saved revisions; reading a status never changes a book.
export async function waivePendingReviewFee(bookId: number, userId: number) {
  return serializable(async tx => {
    await tx.$queryRaw`SELECT id FROM "Book" WHERE id = ${bookId} FOR UPDATE`;
    const book = await tx.book.findFirst({ where: { id: bookId, userId, deletedAt: null } });
    if (!book) throw new Error("Book not found");
    if (book.reviewFeeWaivedAt) return { bookStatus: book.status, reviewFee: reviewFeePolicy(book) };
    if (!reviewPaymentsAreDemo()) throw new Error("Demo review submission is not enabled");
    if (book.status !== "PAYMENT_PENDING") throw new Error("This book is not awaiting review payment");
    const activePayment = await tx.publishingPayment.findFirst({
      where: { bookId, OR: [
        { status: "PAID" },
        { status: "PENDING", OR: [{ providerOrderId: { not: null } }, { initiationStartedAt: { not: null } }] },
      ] },
    });
    if (activePayment) throw new Error("An earlier payment needs verification. Check payment status before continuing.");
    const review = await tx.bookReview.findFirst({ where: { bookId, status: "PAYMENT_PENDING" }, orderBy: { submittedAt: "desc" } });
    if (!review) throw new Error("No submitted version is awaiting review");
    const now = new Date();
    const updated = await tx.book.update({ where: { id: bookId }, data: { status: "IN_REVIEW", reviewFeeWaivedAt: now } });
    await tx.bookReview.update({ where: { id: review.id }, data: { status: "SUBMITTED", submittedAt: now } });
    await tx.bookStatusEvent.create({ data: { bookId, actorId: userId, previousStatus: "PAYMENT_PENDING",
      newStatus: "IN_REVIEW", notes: "Review fee waived in demo mode. No payment collected." } });
    return { bookStatus: updated.status, reviewFee: reviewFeePolicy(updated) };
  });
}
