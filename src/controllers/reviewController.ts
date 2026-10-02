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
  if (!book.frontCoverKey && !book.frontCoverUrl) issues.push("Upload a front cover");
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
      frontCoverKey: book.frontCoverKey,
      backCoverKey: book.backCoverKey,
      frontCoverUrl: book.frontCoverUrl,
      backCoverUrl: book.backCoverUrl,
    } as Prisma.InputJsonObject,
    design: book.design
      ? {
          size: book.design.size,
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
    await requireOwnedBook(bookId, req.userId);
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        design: true,
        chapters: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      },
    });
    if (!book) return res.status(404).json({ message: "Book not found" });
    if (!SUBMITTABLE_STATUSES.includes(book.status)) {
      return res.status(409).json({ message: `A book in ${book.status} cannot be submitted` });
    }
    const issues = buildSubmissionIssues(book);
    if (issues.length) {
      return res.status(422).json({ message: "Complete the book before submitting", issues });
    }

    const snapshot = buildSnapshot(book);
    const contentHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    const latestRevision = await prisma.bookRevision.aggregate({
      where: { bookId },
      _max: { version: true },
    });
    const version = (latestRevision._max.version ?? 0) + 1;
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const transitioned = await tx.book.updateMany({
        where: { id: bookId, userId: req.userId!, status: { in: ["DRAFT", "CHANGES_REQUESTED"] } },
        data: { status: "IN_REVIEW", submittedAt: now, approvedAt: null },
      });
      if (transitioned.count !== 1) throw new Error("STATE_CHANGED");
      const revision = await tx.bookRevision.create({
        data: { bookId, version, snapshot, contentHash },
      });
      const review = await tx.bookReview.create({
        data: { bookId, revisionId: revision.id, submittedById: req.userId!, authorMessage },
        include: { revision: { select: { id: true, version: true, contentHash: true } } },
      });
      await tx.bookStatusEvent.create({
        data: {
          bookId,
          actorId: req.userId!,
          previousStatus: book.status,
          newStatus: "IN_REVIEW",
          notes: authorMessage,
        },
      });
      const updatedBook = await tx.book.findUnique({ where: { id: bookId } });
      return { book: updatedBook, review, revision };
    });
    return res.status(201).json(result);
  } catch (error: any) {
    if (error?.message === "NOT_FOUND") return res.status(404).json({ message: "Book not found" });
    if (error?.message === "FORBIDDEN") return res.status(403).json({ message: "Forbidden" });
    if (error?.message === "STATE_CHANGED" || error?.code === "P2002") {
      return res.status(409).json({ message: "The book changed while it was being submitted. Refresh and try again." });
    }
    console.error("submitBookForReview error:", error);
    return res.status(500).json({ message: "Failed to submit book for review" });
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
) {
  return prisma.$transaction(async (tx) => {
    const review = await tx.bookReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new Error("NOT_FOUND");
    if (review.status !== "SUBMITTED") throw new Error("ALREADY_REVIEWED");
    const previousPayment = reviewStatus === "APPROVED" ? await tx.publishingPayment.findFirst({
      where: { bookId: review.bookId, status: "PAID", amount: 199, currency: "INR" },
    }) : null;
    const nextStatus = previousPayment ? BookStatus.PUBLISHED : bookStatus;
    const transitioned = await tx.book.updateMany({
      where: { id: review.bookId, status: "IN_REVIEW" },
      data: {
        status: nextStatus,
        ...(nextStatus === "PUBLISHED" ? { publishedAt: new Date() } : {}),
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
    try {
      return res.json(await applyDecision(reviewId, req.userId, reviewStatus, bookStatus, notes));
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
