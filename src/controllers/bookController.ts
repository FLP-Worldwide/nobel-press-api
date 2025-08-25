import { Request, Response } from "express";
import prisma from "../utils/prisma";
import { AuthRequest } from "../middleware/authMiddleware";

// Create a new book (only author)
export const createBook = async (req: AuthRequest, res: Response) => {
  const { title, language, authorName, subheading, coAuthor } = req.body;

  try {
    const book = await prisma.book.create({
      data: {
        userId: req.userId!,
        title,
        language,
        authorName,
        subheading,
        coAuthor,
      },
    });
    res.json(book);
  } catch (err) {
    res.status(500).json({ message: "Failed to create book" });
  }
};

// Get all books
export const getAllBooks = async (req: Request, res: Response) => {
  try {
    const books = await prisma.book.findMany({
      include: { chapters: true },
    });
    res.json(books);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch books" });
  }
};

// Get single book by ID
export const getBookById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const book = await prisma.book.findUnique({
      where: { id: Number(id) },
      include: { chapters: true },
    });
    res.json(book);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch book" });
  }
};
