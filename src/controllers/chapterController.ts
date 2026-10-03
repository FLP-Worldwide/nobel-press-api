import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import prisma from "../utils/prisma";
import { accessErrorResponse, requireOwnedEditableBook } from "../utils/bookAccess";

const MAX_CHAPTER_BYTES = 5 * 1024 * 1024;
const CHAPTER_TYPES = new Set(["chapter", "intro", "preface", "section"]);

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sendAccessError(error: unknown, res: Response): boolean {
  const mapped = accessErrorResponse(error);
  if (!mapped) return false;
  res.status(mapped.status).json({ message: mapped.message });
  return true;
}

function validateContent(content: unknown): string | null {
  if (typeof content !== "string") return null;
  return Buffer.byteLength(content, "utf8") <= MAX_CHAPTER_BYTES ? content : null;
}

export const addChapter = async (req: AuthRequest, res: Response) => {
  const bookId = parseId(req.params.bookId);
  if (!bookId) return res.status(400).json({ message: "Invalid bookId" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 200) : "";
  const content = validateContent(req.body?.content ?? "");
  const type = req.body?.type;
  const afterChapterId = req.body?.afterChapterId;
  if (afterChapterId !== undefined && (!Number.isInteger(afterChapterId) || afterChapterId < 1)) {
    return res.status(400).json({ message: "Invalid section to insert after" });
  }
  if (!title || content === null || !CHAPTER_TYPES.has(type)) {
    return res.status(400).json({ message: "Valid title, type, and content (maximum 5 MB) are required" });
  }

  try {
    await requireOwnedEditableBook(bookId, req.userId);
    if (afterChapterId !== undefined && !await prisma.bookChapter.findFirst({ where: { id: afterChapterId, bookId } })) {
      return res.status(400).json({ message: "The preceding section must belong to this book." });
    }
    const chapter = await prisma.$transaction(async (tx) => {
      // Serialize insertions for one book so concurrent tabs cannot overwrite order.
      await tx.book.update({ where: { id: bookId }, data: { updatedAt: new Date() } });
      const existing = await tx.bookChapter.findMany({ where: { bookId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
      const insertion = afterChapterId === undefined ? existing.length : existing.findIndex(item => item.id === afterChapterId) + 1;
      if (afterChapterId !== undefined && insertion === 0) throw new Error("The preceding section was removed.");
      for (let index = 0; index < existing.length; index++) {
        await tx.bookChapter.update({ where: { id: existing[index].id }, data: { position: index >= insertion ? index + 1 : index } });
      }
      return tx.bookChapter.create({ data: { bookId, title, type, content, position: insertion } });
    });
    return res.status(201).json(chapter);
  } catch (error) {
    if (sendAccessError(error, res)) return;
    console.error("addChapter error:", error);
    return res.status(500).json({ message: "Failed to add chapter" });
  }
};

export const getChaptersByBook = async (req: AuthRequest, res: Response) => {
  const bookId = parseId(req.params.bookId);
  if (!bookId) return res.status(400).json({ message: "Invalid bookId" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const book = await prisma.book.findFirst({ where: { id: bookId, deletedAt: null }, select: { userId: true } });
    if (!book) return res.status(404).json({ message: "Book not found" });
    if (req.role !== "admin" && book.userId !== req.userId) return res.status(403).json({ message: "Forbidden" });
    const chapters = await prisma.bookChapter.findMany({
      where: { bookId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return res.json(chapters);
  } catch (error) {
    console.error("getChaptersByBook error:", error);
    return res.status(500).json({ message: "Failed to fetch chapters" });
  }
};

export const updateChapter = async (req: AuthRequest, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid chapter id" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const existing = await prisma.bookChapter.findUnique({ where: { id }, select: { bookId: true } });
    if (!existing) return res.status(404).json({ message: "Chapter not found" });
    await requireOwnedEditableBook(existing.bookId, req.userId);

    const data: { title?: string; content?: string; type?: "chapter" | "intro" | "preface" | "section"; position?: number } = {};
    if (req.body?.title !== undefined) {
      const title = typeof req.body.title === "string" ? req.body.title.trim().slice(0, 200) : "";
      if (!title) return res.status(400).json({ message: "Chapter title cannot be empty" });
      data.title = title;
    }
    if (req.body?.content !== undefined) {
      const content = validateContent(req.body.content);
      if (content === null) return res.status(413).json({ message: "Chapter content must be 5 MB or smaller" });
      data.content = content;
    }
    if (req.body?.type !== undefined) {
      if (!CHAPTER_TYPES.has(req.body.type)) return res.status(400).json({ message: "Invalid chapter type" });
      data.type = req.body.type;
    }
    if (req.body?.position !== undefined) {
      if (!Number.isInteger(req.body.position) || req.body.position < 0) {
        return res.status(400).json({ message: "position must be a non-negative integer" });
      }
      data.position = req.body.position;
    }
    if (!Object.keys(data).length) return res.status(400).json({ message: "No fields to update" });
    return res.json(await prisma.bookChapter.update({ where: { id }, data }));
  } catch (error) {
    if (sendAccessError(error, res)) return;
    console.error("updateChapter error:", error);
    return res.status(500).json({ message: "Failed to update chapter" });
  }
};

export const deleteChapter = async (req: AuthRequest, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid chapter id" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const existing = await prisma.bookChapter.findUnique({ where: { id }, select: { bookId: true } });
    if (!existing) return res.status(404).json({ message: "Chapter not found" });
    await requireOwnedEditableBook(existing.bookId, req.userId);
    await prisma.bookChapter.delete({ where: { id } });
    return res.json({ message: "Chapter deleted" });
  } catch (error) {
    if (sendAccessError(error, res)) return;
    console.error("deleteChapter error:", error);
    return res.status(500).json({ message: "Failed to delete chapter" });
  }
};
