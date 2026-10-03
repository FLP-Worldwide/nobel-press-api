import { Response } from "express";
import { Prisma } from "@prisma/client";
import type {
  BindingType,
  BookInterior,
  BookSize,
  CoverLamination,
  PaperType,
} from "@prisma/client";
import prisma from "../utils/prisma";
import { AuthRequest } from "../middleware/authMiddleware";
import {
  accessErrorResponse,
  requireOwnedBook,
  requireOwnedEditableBook,
} from "../utils/bookAccess";

const authorBookInclude = Prisma.validator<Prisma.BookInclude>()({
  chapters: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
  design: true,
  user: { select: { id: true, name: true } },
  reviews: {
    orderBy: { submittedAt: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      authorMessage: true,
      reviewerNotes: true,
      submittedAt: true,
      reviewedAt: true,
      revision: { select: { id: true, version: true } },
    },
  },
  publishingFees: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      provider: true,
      providerOrderId: true,
      createdAt: true,
      paidAt: true,
    },
  },
});

function idParam(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function cleanRequiredString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= max ? cleaned : null;
}

function cleanOptionalString(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function cleanStringArray(value: unknown, limit: number, itemLimit: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, itemLimit))
    .filter(Boolean))]
    .slice(0, limit);
}

function handleAccessError(error: unknown, res: Response): boolean {
  const mapped = accessErrorResponse(error);
  if (!mapped) return false;
  res.status(mapped.status).json({ message: mapped.message });
  return true;
}

// Public catalog: only paid/published books and never manuscript chapters.
export const getAllBooks = async (_req: AuthRequest, res: Response) => {
  try {
    const books = await prisma.book.findMany({
      where: { status: "PUBLISHED", deletedAt: null },
      select: {
        id: true,
        title: true,
        subheading: true,
        language: true,
        authorName: true,
        coAuthor: true,
        genre: true,
        description: true,
        categories: true,
        keywords: true,
        retailPrice: true,
        currency: true,
        frontCoverUrl: true,
        backCoverUrl: true,
        publishedAt: true,
        design: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: { publishedAt: "desc" },
    });
    return res.json(books);
  } catch (error) {
    console.error("getAllBooks error:", error);
    return res.status(500).json({ message: "Failed to fetch books" });
  }
};

export const getPublicBookById = async (req: AuthRequest, res: Response) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid id" });
  try {
    const book = await prisma.book.findFirst({
      where: { id, status: "PUBLISHED", deletedAt: null },
      select: {
        id: true,
        title: true,
        subheading: true,
        language: true,
        authorName: true,
        coAuthor: true,
        genre: true,
        description: true,
        authorBiography: true,
        categories: true,
        keywords: true,
        retailPrice: true,
        currency: true,
        frontCoverUrl: true,
        backCoverUrl: true,
        publishedAt: true,
        design: true,
        user: { select: { id: true, name: true } },
      },
    });
    if (!book) return res.status(404).json({ message: "Published book not found" });
    return res.json(book);
  } catch (error) {
    console.error("getPublicBookById error:", error);
    return res.status(500).json({ message: "Failed to fetch book" });
  }
};

export const createBook = async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  const title = cleanRequiredString(req.body?.title, 200);
  const language = cleanRequiredString(req.body?.language, 80);
  const authorName = cleanRequiredString(req.body?.authorName, 160);
  if (!title || !language || !authorName) {
    return res.status(400).json({ message: "title, language, and authorName are required" });
  }

  try {
    const book = await prisma.book.create({
      data: {
        userId: req.userId,
        title,
        language,
        authorName,
        subheading: cleanOptionalString(req.body?.subheading, 300),
        coAuthor: cleanOptionalString(req.body?.coAuthor, 160),
        genre: cleanOptionalString(req.body?.genre, 120),
      },
      include: authorBookInclude,
    });
    return res.status(201).json(book);
  } catch (error) {
    console.error("createBook error:", error);
    return res.status(500).json({ message: "Failed to create book" });
  }
};

export const getUserBooks = async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const books = await prisma.book.findMany({
      where: req.role === "admin" ? { deletedAt: null } : { userId: req.userId, deletedAt: null },
      include: authorBookInclude,
      orderBy: { updatedAt: "desc" },
    });
    return res.json(books);
  } catch (error) {
    console.error("getUserBooks error:", error);
    return res.status(500).json({ message: "Failed to fetch books" });
  }
};

export const getBookById = async (req: AuthRequest, res: Response) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid id" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const book = await prisma.book.findFirst({
      where: { id, deletedAt: null },
      include: authorBookInclude,
    });
    if (!book) return res.status(404).json({ message: "Book not found" });
    if (req.role !== "admin" && book.userId !== req.userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return res.json(book);
  } catch (error) {
    console.error("getBookById error:", error);
    return res.status(500).json({ message: "Failed to fetch book" });
  }
};

export const updateBook = async (req: AuthRequest, res: Response) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid id" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    await requireOwnedEditableBook(id, req.userId);
    const data: Prisma.BookUncheckedUpdateInput = {};
    const stringFields: Array<[keyof Prisma.BookUncheckedUpdateInput, number]> = [
      ["title", 200], ["subheading", 300], ["authorName", 160], ["coAuthor", 160],
      ["language", 80], ["genre", 120], ["description", 5000], ["authorBiography", 3000],
    ];
    for (const [field, max] of stringFields) {
      const cleaned = cleanOptionalString(req.body?.[field], max);
      if (cleaned !== undefined) (data as Record<string, unknown>)[field] = cleaned;
    }

    if (typeof data.title === "string" && !data.title) {
      return res.status(400).json({ message: "Title cannot be empty" });
    }
    const categories = cleanStringArray(req.body?.categories, 10, 80);
    const keywords = cleanStringArray(req.body?.keywords, 20, 80);
    if (categories !== undefined) data.categories = categories;
    if (keywords !== undefined) data.keywords = keywords;
    if (typeof req.body?.termsAccepted === "boolean") {
      data.termsAcceptedAt = req.body.termsAccepted ? new Date() : null;
    }
    if (req.body?.retailPrice !== undefined) {
      const price = Number(req.body.retailPrice);
      if (!Number.isFinite(price) || price <= 0 || price > 100000) {
        return res.status(400).json({ message: "retailPrice must be greater than 0" });
      }
      data.retailPrice = new Prisma.Decimal(price.toFixed(2));
    }

    // Status is deliberately absent: transitions have dedicated guarded endpoints.
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: "No supported fields provided to update" });
    }
    const updated = await prisma.book.update({ where: { id }, data, include: authorBookInclude });
    return res.json(updated);
  } catch (error: any) {
    if (handleAccessError(error, res)) return;
    if (error?.code === "P2025") return res.status(404).json({ message: "Book not found" });
    console.error("updateBook error:", error);
    return res.status(500).json({ message: "Failed to update book" });
  }
};

export const upsertBookDesign = async (req: AuthRequest, res: Response) => {
  const bookId = idParam(req.params.bookId);
  if (!bookId) return res.status(400).json({ message: "Invalid bookId" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  const { size, bindingType, interior, paperType, coverLamination, customWidthIn, customHeightIn, layoutStyle } = req.body as {
    size: BookSize;
    bindingType: BindingType;
    interior: BookInterior;
    paperType: PaperType;
    coverLamination: CoverLamination;
    layoutStyle?: string;
    customWidthIn?: string | number | null;
    customHeightIn?: string | number | null;
  };

  try {
    await requireOwnedEditableBook(bookId, req.userId);
    if (layoutStyle !== undefined) {
      const book = await prisma.book.findUnique({ where: { id: bookId }, select: { language: true } });
      const styles = /hindi|हिंदी|हिन्दी/i.test(book?.language || "")
        ? ["hindi-sahitya", "hindi-saral"]
        : ["english-classic", "english-modern", "english-literary"];
      if (!styles.includes(layoutStyle)) return res.status(400).json({ message: "Choose a supported layout for this book's language." });
    }
    if (size === "CUSTOM" && (!customWidthIn || !customHeightIn)) {
      return res.status(400).json({ message: "Custom width and height are required" });
    }
    const design = await prisma.bookDesign.upsert({
      where: { bookId },
      create: {
        bookId, size, bindingType, interior, paperType, coverLamination, layoutStyle,
        customWidthIn: customWidthIn ? new Prisma.Decimal(customWidthIn) : null,
        customHeightIn: customHeightIn ? new Prisma.Decimal(customHeightIn) : null,
      },
      update: {
        size, bindingType, interior, paperType, coverLamination, layoutStyle,
        customWidthIn: customWidthIn ? new Prisma.Decimal(customWidthIn) : null,
        customHeightIn: customHeightIn ? new Prisma.Decimal(customHeightIn) : null,
      },
    });
    return res.json(design);
  } catch (error) {
    if (handleAccessError(error, res)) return;
    console.error("upsertBookDesign error:", error);
    return res.status(500).json({ message: "Failed to save book design" });
  }
};

export const getBookDesign = async (req: AuthRequest, res: Response) => {
  const bookId = idParam(req.params.bookId);
  if (!bookId) return res.status(400).json({ message: "Invalid bookId" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const book = await prisma.book.findFirst({ where: { id: bookId, deletedAt: null }, select: { userId: true } });
    if (!book) return res.status(404).json({ message: "Book not found" });
    if (req.role !== "admin" && book.userId !== req.userId) return res.status(403).json({ message: "Forbidden" });
    const design = await prisma.bookDesign.findUnique({ where: { bookId } });
    if (!design) return res.status(404).json({ message: "Design not found" });
    return res.json(design);
  } catch (error) {
    console.error("getBookDesign error:", error);
    return res.status(500).json({ message: "Failed to fetch book design" });
  }
};

export const deleteBookDesign = async (req: AuthRequest, res: Response) => {
  const bookId = idParam(req.params.bookId);
  if (!bookId) return res.status(400).json({ message: "Invalid bookId" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    await requireOwnedEditableBook(bookId, req.userId);
    await prisma.bookDesign.delete({ where: { bookId } });
    return res.json({ message: "Design deleted" });
  } catch (error: any) {
    if (handleAccessError(error, res)) return;
    if (error?.code === "P2025") return res.status(404).json({ message: "Design not found" });
    return res.status(500).json({ message: "Failed to delete book design" });
  }
};

function validHttpUrl(value?: string | null): boolean {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export const updateBookCovers = async (req: AuthRequest, res: Response) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid book id" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    await requireOwnedEditableBook(id, req.userId);
    const { frontCoverKey, backCoverKey, frontCoverUrl, backCoverUrl } = req.body ?? {};
    const ownedPrefix = `users/${req.userId}/`;
    for (const key of [frontCoverKey, backCoverKey]) {
      if (key && (typeof key !== "string" || !key.startsWith(ownedPrefix))) {
        return res.status(403).json({ message: "Cover key does not belong to this user" });
      }
    }
    if (!validHttpUrl(frontCoverUrl) || !validHttpUrl(backCoverUrl)) {
      return res.status(400).json({ message: "Invalid URL format" });
    }
    const data: Prisma.BookUncheckedUpdateInput = {};
    if (frontCoverKey !== undefined) data.frontCoverKey = frontCoverKey || null;
    if (backCoverKey !== undefined) data.backCoverKey = backCoverKey || null;
    if (frontCoverUrl !== undefined) data.frontCoverUrl = frontCoverUrl || null;
    if (backCoverUrl !== undefined) data.backCoverUrl = backCoverUrl || null;
    if (!Object.keys(data).length) return res.status(400).json({ message: "No fields to update" });
    const book = await prisma.book.update({ where: { id }, data, include: authorBookInclude });
    return res.json({ message: "Covers updated", book });
  } catch (error) {
    if (handleAccessError(error, res)) return;
    console.error("updateBookCovers error:", error);
    return res.status(500).json({ message: "Failed to update covers" });
  }
};

export const deleteBook = async (req: AuthRequest, res: Response) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid book id" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const book = await requireOwnedEditableBook(id, req.userId);
    if (book.deletedAt) return res.status(409).json({ message: "Book already deleted" });
    await prisma.book.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: req.userId } });
    return res.json({ ok: true, id, message: "Book deleted" });
  } catch (error) {
    if (handleAccessError(error, res)) return;
    return res.status(500).json({ message: "Failed to delete book" });
  }
};

export const restoreBook = async (req: AuthRequest, res: Response) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid book id" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const book = await prisma.book.findUnique({ where: { id } });
    if (!book) return res.status(404).json({ message: "Book not found" });
    if (book.userId !== req.userId) return res.status(403).json({ message: "Forbidden" });
    if (!book.deletedAt) return res.status(409).json({ message: "Book is not deleted" });
    await prisma.book.update({ where: { id }, data: { deletedAt: null, deletedBy: null } });
    return res.json({ ok: true, id, message: "Book restored" });
  } catch (error) {
    console.error("restoreBook error:", error);
    return res.status(500).json({ message: "Failed to restore book" });
  }
};
