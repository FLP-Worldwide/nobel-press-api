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

//Get all books publicly (only non-deleted books)
export const getAllBooks = async (req: Request, res: Response) => {
  try {
    const books = await prisma.book.findMany({
      where: { deletedAt: null }, // filter out soft-deleted books
      include: {
        chapters: true, // include chapters
        design: true,   // include design
        user: {         // include limited user info
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" }, // latest books first
    });

    if (!books || books.length === 0) {
      return res.status(404).json({ message: "No books found" });
    }

    res.json(books);
  } catch (err) {
    console.error("getAllBooks error:", err);
    res.status(500).json({ message: "Failed to fetch books" });
  }
};



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
export const getUserBooks = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ message: "Unauthorized" });

    const books = await prisma.book.findMany({
      where: { userId: req.userId, deletedAt: null }, // ✅ Only logged-in user's books
      include: {
        chapters: true,
        design: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(books);
  } catch (err) {
    console.error("getUserBooks error:", err);
    res.status(500).json({ message: "Failed to fetch books" });
  }
};




// Get single book by ID
export const getBookById = async (req: Request, res: Response) => {
  const idNum = Number(req.params.id);
  if (Number.isNaN(idNum)) return res.status(400).json({ message: "Invalid id" });

  try {
    const book = await prisma.book.findUnique({
      where: { id: idNum, deletedAt: null },
      include: { chapters: true, design: true, user: { select: { id: true, name: true } } },
    });
    if (!book) return res.status(404).json({ message: "Book not found" });
    res.json(book);
  } catch (err) {
    console.error("getBookById error:", err);
    res.status(500).json({ message: "Failed to fetch book" });
  }
};

// Update book (partial) — author only
export const updateBook = async (req: AuthRequest, res: Response) => {
  const idNum = Number(req.params.id);
  if (Number.isNaN(idNum)) return res.status(400).json({ message: "Invalid id" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    // Ensure the book exists and belongs to the caller
    await assertBookOwnership(idNum, req.userId);

    // Whitelist fields (ignore anything else)
    const {
      title,
      subheading,
      authorName,
      coAuthor,
      language,
      genre,
      status, // optional: if you use it on the Book model
    } = req.body as Partial<{
      title: string;
      subheading: string | null;
      authorName: string;
      coAuthor: string | null;
      language: string;
      genre: string;
      status: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "INACTIVE";
    }>;

    // Build payload only with defined keys so Prisma doesn't overwrite other fields
    const data: Record<string, any> = {};
    if (typeof title !== "undefined") data.title = title;
    if (typeof subheading !== "undefined") data.subheading = subheading; // allow null
    if (typeof authorName !== "undefined") data.authorName = authorName;
    if (typeof coAuthor !== "undefined") data.coAuthor = coAuthor;       // allow null
    if (typeof language !== "undefined") data.language = language;
    if (typeof genre !== "undefined") data.genre = genre;
    if (typeof status !== "undefined") data.status = status;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: "No fields provided to update" });
    }

    const updated = await prisma.book.update({
      where: { id: idNum },
      data,
      include: {
        chapters: true,
        design: true,
        user: { select: { id: true, name: true } },
      },
    });

    return res.json(updated);
  } catch (err: any) {
    if (err?.message === "NOT_FOUND") return res.status(404).json({ message: "Book not found" });
    if (err?.message === "FORBIDDEN") return res.status(403).json({ message: "Forbidden" });
    if (err?.code === "P2025") return res.status(404).json({ message: "Book not found" });
    console.error("updateBook error:", err);
    return res.status(500).json({ message: "Failed to update book" });
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


type UpdateCoversBody = {
  frontCoverKey?: string | null;
  backCoverKey?: string | null;
  frontCoverUrl?: string | null;
  backCoverUrl?: string | null;
};

function isValidUrl(v?: string | null) {
  if (!v) return true;
  try { new URL(v); return true; } catch { return false; }
}

export async function updateBookCovers(
  req: AuthRequest & Request<{ id: string }, unknown, UpdateCoversBody>,
  res: Response
) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid book id" });

    const { frontCoverKey, backCoverKey, frontCoverUrl, backCoverUrl } = req.body || {};

    // Basic URL validation (optional fields)
    if (!isValidUrl(frontCoverUrl) || !isValidUrl(backCoverUrl)) {
      return res.status(400).json({ message: "Invalid URL format" });
    }

    const book = await prisma.book.findUnique({ where: { id } });
    if (!book) return res.status(404).json({ message: "Book not found" });

    // Build partial update only for provided fields
    const data: Record<string, string | null> = {};
    if (typeof frontCoverKey !== "undefined") data.frontCoverKey = frontCoverKey || null;
    if (typeof backCoverKey !== "undefined") data.backCoverKey = backCoverKey || null;
    if (typeof frontCoverUrl !== "undefined") data.frontCoverUrl = frontCoverUrl || null;
    if (typeof backCoverUrl !== "undefined") data.backCoverUrl = backCoverUrl || null;

    // Nothing to update?
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    const updated = await prisma.book.update({
      where: { id },
      data,
      select: {
        id: true,
        frontCoverKey: true,
        backCoverKey: true,
        frontCoverUrl: true,
        backCoverUrl: true,
        updatedAt: true,
      },
    });

    return res.json({ message: "Covers updated", book: updated });
  } catch (err: any) {
    console.error("updateBookCovers error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}


// Soft delete: sirf Book ko mark karo, children ko mat chuo
export async function deleteBook(req: AuthRequest, res: Response) {
  const bookId = Number(req.params.id);
  if (Number.isNaN(bookId)) {
    return res.status(400).json({ message: "Invalid book id" });
  }

  try {
    // 1) Check ownership + current delete state
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      select: {
        id: true,
        userId: true,
        deletedAt: true,
      },
    });

    if (!book) return res.status(404).json({ message: "Book not found" });
    if (book.userId !== req.userId) {
      return res.status(403).json({ message: "Not allowed to delete this book" });
    }
    if (book.deletedAt) {
      return res.status(409).json({ message: "Book already deleted" });
    }

    // 2) Soft delete (no child delete)
    await prisma.book.update({
      where: { id: bookId },
      data: {
        deletedAt: new Date(),
        deletedBy: req.userId,
      },
    });

    // 200 (json) > 204 (no body) for frontend clarity
    return res.status(200).json({ ok: true, id: bookId, message: "Book soft-deleted" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to soft delete book" });
  }
}


export async function restoreBook(req: AuthRequest, res: Response) {
  const bookId = Number(req.params.id);
  if (Number.isNaN(bookId)) {
    return res.status(400).json({ message: "Invalid book id" });
  }

  try {
    // 1) Check ownership + current state
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      select: {
        id: true,
        userId: true,
        deletedAt: true,
      },
    });

    if (!book) return res.status(404).json({ message: "Book not found" });
    if (book.userId !== req.userId) {
      return res.status(403).json({ message: "Not allowed to restore this book" });
    }
    if (!book.deletedAt) {
      return res.status(409).json({ message: "Book is not deleted" });
    }

    // 2) Restore
    await prisma.book.update({
      where: { id: bookId },
      data: {
        deletedAt: null,
        deletedBy: null,
      },
    });

    return res.json({ ok: true, id: bookId, message: "Book restored" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to restore book" });
  }
}



