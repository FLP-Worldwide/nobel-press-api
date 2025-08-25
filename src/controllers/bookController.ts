import { Request, Response } from "express";
import prisma from "../utils/prisma";
import { AuthRequest } from "../middleware/authMiddleware";

// Enums come directly from @prisma/client (NOT from Prisma.*)
import type {
  BookSize,
  BindingType,
  BookInterior,
  PaperType,
  CoverLamination,
} from "@prisma/client";

// For Prisma.Decimal
import { Prisma } from "@prisma/client";

/* =========================
   Helpers
   ========================= */

async function assertBookOwnership(bookId: number, userId: number) {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { userId: true },
  });
  if (!book) throw new Error("NOT_FOUND");
  if (book.userId !== userId) throw new Error("FORBIDDEN");
}

/* =========================
   Books
   ========================= */

// Create a new book (only author)
export const createBook = async (req: AuthRequest, res: Response) => {
  const { title, language, authorName, subheading, coAuthor, genre } = req.body;

  try {
    if (!req.userId) return res.status(401).json({ message: "Unauthorized" });

    const book = await prisma.book.create({
      data: {
        userId: req.userId,
        title,
        genre,
        language,
        authorName,
        subheading,
        coAuthor,
      },
      include: { chapters: true, design: true },
    });

    res.json(book);
  } catch (err) {
    console.error("createBook error:", err);
    res.status(500).json({ message: "Failed to create book" });
  }
};

// Get all books
export const getAllBooks = async (_req: Request, res: Response) => {
  try {
    const books = await prisma.book.findMany({
      include: { chapters: true, design: true, user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(books);
  } catch (err) {
    console.error("getAllBooks error:", err);
    res.status(500).json({ message: "Failed to fetch books" });
  }
};

// Get single book by ID
export const getBookById = async (req: Request, res: Response) => {
  const idNum = Number(req.params.id);
  if (Number.isNaN(idNum)) return res.status(400).json({ message: "Invalid id" });

  try {
    const book = await prisma.book.findUnique({
      where: { id: idNum },
      include: { chapters: true, design: true, user: { select: { id: true, name: true } } },
    });
    if (!book) return res.status(404).json({ message: "Book not found" });
    res.json(book);
  } catch (err) {
    console.error("getBookById error:", err);
    res.status(500).json({ message: "Failed to fetch book" });
  }
};

/* =========================
   Book Design (Create/Update/Get/Delete)
   ========================= */

// Upsert BookDesign for a book (author only)
export const upsertBookDesign = async (req: AuthRequest, res: Response) => {
  const bId = Number(req.params.bookId);
  if (Number.isNaN(bId)) return res.status(400).json({ message: "Invalid bookId" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });

  // Expect values matching Prisma enums exactly
  const {
    size,
    bindingType,
    interior,
    paperType,
    coverLamination,
    customWidthIn,
    customHeightIn,
  } = req.body as {
    size: BookSize;                // e.g. "SIX_X_NINE"
    bindingType: BindingType;      // "PAPERBACK" | "HARDCOVER"
    interior: BookInterior;        // "BLACK_WHITE" | "COLOR"
    paperType: PaperType;          // "CREAM" | "WHITE" | "ART_MATTE"
    coverLamination: CoverLamination; // "MATTE" | "GLOSS" | "NONE"
    customWidthIn?: string | number | null;
    customHeightIn?: string | number | null;
  };

  try {
    // Check ownership
    await assertBookOwnership(bId, req.userId);

    // Validate custom size
    if (size === "CUSTOM") {
      if (!customWidthIn || !customHeightIn) {
        return res.status(400).json({
          message: "For CUSTOM size, customWidthIn and customHeightIn are required.",
        });
      }
    }

    const design = await prisma.bookDesign.upsert({
      where: { bookId: bId },
      create: {
        bookId: bId,
        size,
        bindingType,
        interior,
        paperType,
        coverLamination,
        customWidthIn: customWidthIn ? new Prisma.Decimal(customWidthIn) : null,
        customHeightIn: customHeightIn ? new Prisma.Decimal(customHeightIn) : null,
      },
      update: {
        size,
        bindingType,
        interior,
        paperType,
        coverLamination,
        customWidthIn: customWidthIn ? new Prisma.Decimal(customWidthIn) : null,
        customHeightIn: customHeightIn ? new Prisma.Decimal(customHeightIn) : null,
      },
    });

    return res.json(design);
  } catch (err: any) {
    console.error("upsertBookDesign error:", err);
    if (err?.message === "NOT_FOUND") return res.status(404).json({ message: "Book not found" });
    if (err?.message === "FORBIDDEN") return res.status(403).json({ message: "Forbidden" });
    return res.status(500).json({ message: "Failed to upsert book design" });
  }
};

// Get BookDesign by bookId
export const getBookDesign = async (req: Request, res: Response) => {
  const bId = Number(req.params.bookId);
  if (Number.isNaN(bId)) return res.status(400).json({ message: "Invalid bookId" });

  try {
    const design = await prisma.bookDesign.findUnique({ where: { bookId: bId } });
    if (!design) return res.status(404).json({ message: "Design not found" });
    return res.json(design);
  } catch (err) {
    console.error("getBookDesign error:", err);
    return res.status(500).json({ message: "Failed to fetch book design" });
  }
};

// Delete BookDesign (author only)
export const deleteBookDesign = async (req: AuthRequest, res: Response) => {
  const bId = Number(req.params.bookId);
  if (Number.isNaN(bId)) return res.status(400).json({ message: "Invalid bookId" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    await assertBookOwnership(bId, req.userId);
    await prisma.bookDesign.delete({ where: { bookId: bId } });
    return res.json({ message: "Design deleted" });
  } catch (err: any) {
    console.error("deleteBookDesign error:", err);
    if (err?.code === "P2025") return res.status(404).json({ message: "Design not found" });
    if (err?.message === "NOT_FOUND") return res.status(404).json({ message: "Book not found" });
    if (err?.message === "FORBIDDEN") return res.status(403).json({ message: "Forbidden" });
    return res.status(500).json({ message: "Failed to delete book design" });
  }
};
