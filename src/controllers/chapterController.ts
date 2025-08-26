import { Request, Response } from "express";
import prisma from "../utils/prisma";
import { AuthRequest } from "../middleware/authMiddleware";

// Create (author only) — already had
export const addChapter = async (req: AuthRequest, res: Response) => {
  const { bookId } = req.params;
  const { title, type, content } = req.body;

  try {
    const book = await prisma.book.findUnique({
      where: { id: Number(bookId) },
      select: { userId: true },
    });
    if (!book || book.userId !== req.userId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const chapter = await prisma.bookChapter.create({
      data: { bookId: Number(bookId), title, type, content },
    });
    res.json(chapter);
  } catch (err) {
    res.status(500).json({ message: "Failed to add chapter" });
  }
};

// Read list — already had
export const getChaptersByBook = async (req: Request, res: Response) => {
  const { bookId } = req.params;
  try {
    const chapters = await prisma.bookChapter.findMany({
      where: { bookId: Number(bookId) },
      orderBy: { createdAt: "asc" },
    });
    res.json(chapters);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch chapters" });
  }
};

// 🔄 Update one chapter (author only)
export const updateChapter = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { title, content, type } = req.body as {
    title?: string;
    content?: string;
    type?: "chapter" | "intro" | "preface";
  };

  try {
    // Check the chapter exists and belongs to the current user (via its book)
    const existing = await prisma.bookChapter.findUnique({
      where: { id: Number(id) },
      select: { id: true, book: { select: { userId: true } } },
    });

    if (!existing) return res.status(404).json({ message: "Chapter not found" });
    if (!req.userId || existing.book.userId !== req.userId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const updated = await prisma.bookChapter.update({
      where: { id: Number(id) },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(type !== undefined ? { type } : {}),
      },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: "Failed to update chapter" });
  }
};

// 🗑️ Delete one chapter (author only) — optional
export const deleteChapter = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    const existing = await prisma.bookChapter.findUnique({
      where: { id: Number(id) },
      select: { id: true, book: { select: { userId: true } } },
    });

    if (!existing) return res.status(404).json({ message: "Chapter not found" });
    if (!req.userId || existing.book.userId !== req.userId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    await prisma.bookChapter.delete({ where: { id: Number(id) } });
    res.json({ message: "Chapter deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete chapter" });
  }
};
