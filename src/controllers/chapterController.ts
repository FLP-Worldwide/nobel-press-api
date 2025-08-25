import { Request, Response } from "express";
import prisma from "../utils/prisma";
import { AuthRequest } from "../middleware/authMiddleware";

// Add chapter to a book (only author)
export const addChapter = async (req: AuthRequest, res: Response) => {
  const { bookId } = req.params;
  const { title, type, content } = req.body;

  try {
    // Optional: verify that current user owns the book
    const book = await prisma.book.findUnique({ where: { id: Number(bookId) } });
    if (!book || book.userId !== req.userId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const chapter = await prisma.bookChapter.create({
      data: {
        bookId: Number(bookId),
        title,
        type,
        content,
      },
    });
    res.json(chapter);
  } catch (err) {
    res.status(500).json({ message: "Failed to add chapter" });
  }
};

// Get chapters of a book
export const getChaptersByBook = async (req: Request, res: Response) => {
  const { bookId } = req.params;
  try {
    const chapters = await prisma.bookChapter.findMany({
      where: { bookId: Number(bookId) },
    });
    res.json(chapters);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch chapters" });
  }
};
