import { coverMatchesTrim } from "../utils/coverDesign";
import { createHash } from "crypto";
import { BookReviewStatus, BookStatus, Prisma } from "@prisma/client";
import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import prisma from "../utils/prisma";
import { requireOwnedBook } from "../utils/bookAccess";

const SUBMITTABLE_STATUSES: BookStatus[] = [BookStatus.DRAFT, BookStatus.CHANGES_REQUESTED];

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function jsonArrayHasValue(value: Prisma.JsonValue | null): boolean {
  return Array.isArray(value) && value.some(hasText);
}

function buildSubmissionIssues(book: any): string[] {
  const issues: string[] = [];
  if (!hasText(book.title)) issues.push("Add a book title");
  if (!hasText(book.language)) issues.push("Select a language");
  if (!hasText(book.authorName)) issues.push("Add the author name");
  if (!hasText(book.description)) issues.push("Add the book description/blurb");
  if (!hasText(book.authorBiography)) issues.push("Add the author biography");
  if (!hasText(book.genre) && !jsonArrayHasValue(book.categories)) issues.push("Add at least one category or genre");
  if (!jsonArrayHasValue(book.keywords)) issues.push("Add at least one keyword");
  if (!book.termsAcceptedAt) issues.push("Accept the publishing terms");
  if (!book.design) issues.push("Choose the book design and print specifications");
  if (!book.frontCoverKey && !book.frontCoverUrl && !book.coverDesign?.front) issues.push("Design or upload a front cover");
  if (book.coverDesign && !coverMatchesTrim(book.coverDesign,book.design)) issues.push("Open the cover designer and save your cover to match the current page size");
  if (!book.chapters.some((chapter: any) => hasText(chapter.content))) {
    issues.push("Add manuscript content to at least one chapter");
  }
  return issues;
}

function buildSnapshot(book: any): Prisma.InputJsonObject {
  return {
    schemaVersion: 1,
    book: {
      id: book.id,
      title: book.title,
      subheading: book.subheading,
      language: book.language,
      authorName: book.authorName,
      coAuthor: book.coAuthor,
      genre: book.genre,
      description: book.description,
      authorBiography: book.authorBiography,
      categories: book.categories ?? [],
      keywords: book.keywords ?? [],
      retailPrice: book.retailPrice?.toString() ?? null,
      currency: book.currency,
      termsAcceptedAt: book.termsAcceptedAt?.toISOString() ?? null,
      coverDesign: book.coverDesign ?? null,
      frontCoverKey: book.frontCoverKey,
      backCoverKey: book.backCoverKey,
      frontCoverUrl: book.frontCoverUrl,
      backCoverUrl: book.backCoverUrl,
    } as Prisma.InputJsonObject,
    design: book.design
      ? {
          size: book.design.size,
          layoutStyle: book.design.layoutStyle ?? null,
          bindingType: book.design.bindingType,
          interior: book.design.interior,
          paperType: book.design.paperType,
          coverLamination: book.design.coverLamination,
          customWidthIn: book.design.customWidthIn?.toString() ?? null,
          customHeightIn: book.design.customHeightIn?.toString() ?? null,
        }
      : null,
    chapters: book.chapters.map((chapter: any) => ({
      sourceChapterId: chapter.id,
      title: chapter.title,
      type: chapter.type,
      position: chapter.position,
      content: chapter.content,
      updatedAt: chapter.updatedAt.toISOString(),
    })),
    capturedAt: new Date().toISOString(),
  } as Prisma.InputJsonObject;
}

export const submitBookForReview = async (req: AuthRequest, res: Response) => {
  const bookId = parseId(req.params.id);
  if (!bookId) return res.status(400).json({ message: "Invalid book id" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  const authorMessage = typeof req.body?.message === "string"
    ? req.body.message.trim().slice(0, 3000) || null
    : null;

  try {
    // Read and prepare the manuscript before opening the write transaction.
    // Every author edit locks this same book row and advances updatedAt; the
    // guarded transition below rejects a snapshot changed during preparation.
    const book = await prisma.book.findFirst({
      where: { id: bookId, deletedAt: null },
      include: { design: true, chapters: { orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }] } },
    });
    if (!book) throw new Error("NOT_FOUND");
    if (book.userId !== req.userId) throw new Error("FORBIDDEN");
    const issues = SUBMITTABLE_STATUSES.includes(book.status) ? buildSubmissionIssues(book) : [];
    const snapshot = SUBMITTABLE_STATUSES.includes(book.status) && !issues.length ? buildSnapshot(book) : null;
    const contentHash = snapshot ? createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") : null;
    const revisionSummary = { id: true, version: true, contentHash: true } as const;
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Book" WHERE id = ${bookId} FOR UPDATE`;
      const current = await tx.book.findFirst({
        where: { id: bookId, deletedAt: null },
        select: { id: true, userId: true, status: true, updatedAt: true, submittedAt: true },
      });
      if (!current) throw new Error("NOT_FOUND");
      if (current.userId !== req.userId) throw new Error("FORBIDDEN");
      // A lost response or concurrent double click must return the one saved
      // submission, without creating a revision, status event or payment again.
      if (current.status === BookStatus.PAYMENT_PENDING || current.status === BookStatus.IN_REVIEW) {
        const review = await tx.bookReview.findFirst({
          where: { bookId, status: current.status === BookStatus.IN_REVIEW ? "SUBMITTED" : "PAYMENT_PENDING" },
          orderBy: { submittedAt: "desc" },
          include: { revision: { select: revisionSummary } },
        });
        if (!review) throw new Error("STATE_CHANGED");
        return { book: current, review, revision: review.revision, alreadySubmitted: true,
          reviewFee: { amount: 199, amountPaise: 19900, currency: "INR", paid: current.status === BookStatus.IN_REVIEW } };
      }
      if (!SUBMITTABLE_STATUSES.includes(current.status) ||
          current.status !== book.status || current.updatedAt.getTime() !== book.updatedAt.getTime()) throw new Error("STATE_CHANGED");
      if (issues.length) throw Object.assign(new Error("INCOMPLETE"), { issues });
      if (!snapshot || !contentHash) throw new Error("STATE_CHANGED");
      const latest = await tx.bookRevision.aggregate({ where: { bookId }, _max: { version: true } });
      const version = (latest._max.version ?? 0) + 1;
      const now = new Date();
      const paidFee = await tx.publishingPayment.findFirst({
        where: { bookId, status: "PAID", amount: 199, currency: "INR" }, select: { id: true },
      });
      const nextStatus = paidFee ? BookStatus.IN_REVIEW : BookStatus.PAYMENT_PENDING;
      const transitioned = await tx.book.updateMany({
        where: { id: bookId, userId: req.userId!, updatedAt: book.updatedAt, status: book.status, deletedAt: null },
        data: { status: nextStatus, submittedAt: now, approvedAt: null },
      });
      if (transitioned.count !== 1) throw new Error("STATE_CHANGED");
      const revision = await tx.bookRevision.create({
        data: { bookId, version, snapshot, contentHash }, select: revisionSummary,
      });
      const review = await tx.bookReview.create({
        data: { bookId, revisionId: revision.id, submittedById: req.userId!, authorMessage, status: paidFee ? "SUBMITTED" : "PAYMENT_PENDING" },
        include: { revision: { select: revisionSummary } },
      });
      await tx.bookStatusEvent.create({
        data: { bookId, actorId: req.userId!, previousStatus: book.status, newStatus: nextStatus, notes: authorMessage },
        select: { id: true },
      });
      return { book: { id: bookId, status: nextStatus, submittedAt: now }, review, revision,
        reviewFee: { amount: 199, amountPaise: 19900, currency: "INR", paid: Boolean(paidFee) } };
    }, { maxWait: 5000, timeout: 15000 });
    return res.status(201).json(result);
  } catch (error: any) {
    if (error?.message === "INCOMPLETE") return res.status(422).json({ message: "A few book details still need your attention.", code: "SUBMISSION_INCOMPLETE", issues: error.issues });
    if (error?.message === "NOT_FOUND") return res.status(404).json({ message: "Book not found" });
    if (error?.message === "FORBIDDEN") return res.status(403).json({ message: "Forbidden" });
    if (error?.message === "STATE_CHANGED" || error?.code === "P2002") {
      return res.status(409).json({ message: "Your book changed while we were preparing it. Check your latest changes and submit again.", code: "BOOK_CHANGED" });
    }
    console.error("submitBookForReview failed", { bookId, code: error?.code || "UNKNOWN" });
    return res.status(503).json({ message: "We couldn’t confirm your submission. Your saved draft is safe. Please try again in a moment.", code: "SUBMISSION_UNAVAILABLE", retryable: true });
  }
};

export const getBookReviewStatus = async (req: AuthRequest, res: Response) => {
  const bookId = parseId(req.params.id);
  if (!bookId) return res.status(400).json({ message: "Invalid book id" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const book = await prisma.book.findFirst({ where: { id: bookId, deletedAt: null } });
    if (!book) return res.status(404).json({ message: "Book not found" });
    if (req.role !== "admin" && book.userId !== req.userId) return res.status(403).json({ message: "Forbidden" });
    const [review, publishingPayment] = await Promise.all([
      prisma.bookReview.findFirst({
        where: { bookId },
        orderBy: { submittedAt: "desc" },
        include: { revision: { select: { id: true, version: true, contentHash: true } } },
      }),
      prisma.publishingPayment.findFirst({ where: { bookId }, orderBy: { createdAt: "desc" } }),
    ]);
    return res.json({
      bookId,
      status: book.status,
      review,
      publishingPayment,
      publishingFee: { amount: 199, amountPaise: 19900, currency: "INR" },
      reviewFee: { amount: 199, amountPaise: 19900, currency: "INR" },
    });
  } catch (error) {
    console.error("getBookReviewStatus error:", error);
    return res.status(500).json({ message: "Failed to fetch review status" });
  }
};

export const listReviews = async (req: AuthRequest, res: Response) => {
  const requestedStatus = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "SUBMITTED";
  const allowed = new Set(Object.values(BookReviewStatus));
  if (!allowed.has(requestedStatus as BookReviewStatus)) {
    return res.status(400).json({ message: "Invalid review status" });
  }
  try {
    const reviews = await prisma.bookReview.findMany({
      where: { status: requestedStatus as BookReviewStatus },
      select: {
        id: true,
        status: true,
        authorMessage: true,
        reviewerNotes: true,
        submittedAt: true,
        reviewedAt: true,
        revision: { select: { id: true, version: true, contentHash: true } },
        book: {
          select: {
            id: true, title: true, authorName: true, status: true,
            frontCoverUrl: true, language: true, genre: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: { submittedAt: "asc" },
    });
    return res.json({ reviews });
  } catch (error) {
    console.error("listReviews error:", error);
    return res.status(500).json({ message: "Failed to fetch review queue" });
  }
};

export const getReviewById = async (req: AuthRequest, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid review id" });
  try {
    const review = await prisma.bookReview.findUnique({
      where: { id },
      include: {
        revision: true,
        submittedBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
        book: { include: { design: true, user: { select: { id: true, name: true, email: true } } } },
      },
    });
    if (!review) return res.status(404).json({ message: "Review not found" });
    return res.json({ review, book: review.book, revision: review.revision });
  } catch (error) {
    console.error("getReviewById error:", error);
    return res.status(500).json({ message: "Failed to fetch review" });
  }
};

async function applyDecision(
  reviewId: number,
  actorId: number,
  reviewStatus: BookReviewStatus,
  bookStatus: BookStatus,
  notes: string | null,
  pricing?: { pageCount: number; printCost: Prisma.Decimal },
) {
  return prisma.$transaction(async (tx) => {
    const review = await tx.bookReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new Error("NOT_FOUND");
    if (review.status !== "SUBMITTED") throw new Error("ALREADY_REVIEWED");
    const paidFee = await tx.publishingPayment.findFirst({ where: { bookId: review.bookId, status: "PAID", amount: 199, currency: "INR" } });
    if (!paidFee) throw new Error("STATE_CHANGED");
    const nextStatus = bookStatus;
    const transitioned = await tx.book.updateMany({
      where: { id: review.bookId, status: "IN_REVIEW" },
      data: {
        status: nextStatus,
        ...(pricing || {}),
        approvedAt: bookStatus === "APPROVED" ? new Date() : null,
      },
    });
    if (transitioned.count !== 1) throw new Error("STATE_CHANGED");
    const updatedReview = await tx.bookReview.update({
      where: { id: reviewId },
      data: { status: reviewStatus, reviewerNotes: notes, reviewedById: actorId, reviewedAt: new Date() },
      include: { revision: { select: { id: true, version: true, contentHash: true } } },
    });
    await tx.bookStatusEvent.create({
      data: { bookId: review.bookId, actorId, previousStatus: "IN_REVIEW", newStatus: nextStatus, notes },
    });
    const book = await tx.book.findUnique({ where: { id: review.bookId } });
    return { review: updatedReview, book };
  });
}

function decisionHandler(reviewStatus: BookReviewStatus, bookStatus: BookStatus, requireNotes: boolean) {
  return async (req: AuthRequest, res: Response) => {
    const reviewId = parseId(req.params.id);
    if (!reviewId) return res.status(400).json({ message: "Invalid review id" });
    if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim().slice(0, 5000) || null : null;
    if (requireNotes && !notes) return res.status(400).json({ message: "Reviewer notes are required" });
    let pricing: { pageCount: number; printCost: Prisma.Decimal } | undefined;
    if (reviewStatus === "APPROVED") {
      const pageCount = Number(req.body?.pageCount);
      const printCost = Number(req.body?.printCost);
      if (typeof req.body?.pageCount === "boolean" || typeof req.body?.printCost === "boolean" || !Number.isInteger(pageCount) || pageCount < 1 || pageCount > 10000 ||
          !Number.isFinite(printCost) || printCost <= 0 || printCost > 100000 ||
          Math.abs(printCost * 100 - Math.round(printCost * 100)) > 0.000001) {
        return res.status(400).json({ message: "Set the reviewed page count and printing cost per copy (up to two decimal places) before approval" });
      }
      pricing = { pageCount, printCost: new Prisma.Decimal(printCost) };
    }
    try {
      return res.json(await applyDecision(reviewId, req.userId, reviewStatus, bookStatus, notes, pricing));
    } catch (error: any) {
      if (error?.message === "NOT_FOUND") return res.status(404).json({ message: "Review not found" });
      if (["ALREADY_REVIEWED", "STATE_CHANGED"].includes(error?.message)) {
        return res.status(409).json({ message: "This review has already been decided or the book state changed" });
      }
      console.error("review decision error:", error);
      return res.status(500).json({ message: "Failed to record review decision" });
    }
  };
}

export const approveReview = decisionHandler("APPROVED", "APPROVED", false);
export const requestReviewChanges = decisionHandler("CHANGES_REQUESTED", "CHANGES_REQUESTED", true);
export const rejectReview = decisionHandler("REJECTED", "REJECTED", true);

// Opening a revision removes the mutable edition from the public catalogue.
// Existing immutable review snapshots and the original paid fee are retained.
export const startBookRevision = async (req: AuthRequest, res: Response) => {
  const id = parseId(req.params.id);
  if (!id || !req.userId) return res.status(400).json({ message: "Invalid request" });
  try {
    const book = await requireOwnedBook(id, req.userId);
    if (!["PUBLISHED", "APPROVED", "REJECTED"].includes(book.status)) {
      return res.status(409).json({ message: "Wait for the review or payment decision before starting changes" });
    }
    const result = await prisma.$transaction(async tx => {
      const changed = await tx.book.updateMany({ where: { id, userId: req.userId!, status: book.status }, data: { status: "CHANGES_REQUESTED", approvedAt: null } });
      if (changed.count !== 1) throw new Error("STATE_CHANGED");
      await tx.bookStatusEvent.create({ data: { bookId: id, actorId: req.userId!, previousStatus: book.status, newStatus: "CHANGES_REQUESTED", notes: "Author opened a new revision; review required before publication" } });
      return tx.book.findUnique({ where: { id } });
    });
    return res.json({ book: result });
  } catch (error: any) {
    return res.status(error.message === "FORBIDDEN" ? 403 : error.message === "NOT_FOUND" ? 404 : 409).json({ message: "Cannot start this revision. Refresh and try again." });
  }
};
