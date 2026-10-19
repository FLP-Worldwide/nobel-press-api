import { Response } from "express";
import { createHash } from "crypto";
import { AuthRequest } from "../middleware/authMiddleware";
import prisma from "../utils/prisma";
import { accessErrorResponse, requireOwnedEditableBook, withEditableBook } from "../utils/bookAccess";

const MAX_CHAPTER_BYTES = 5 * 1024 * 1024;
const CHAPTER_TYPES = new Set(["chapter", "intro", "preface", "section"]);

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sendAccessError(error: unknown, res: Response): boolean {
  const mapped = accessErrorResponse(error);
  if (!mapped) return false;
  res.status(mapped.status).json({ message: mapped.message, code: error instanceof Error ? error.message : undefined });
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
  const creationKey = req.get("Idempotency-Key") || null;
  if (creationKey !== null && !/^[A-Za-z0-9_.:-]{8,128}$/.test(creationKey)) {
    return res.status(400).json({ message: "Please refresh the editor before adding another chapter", code: "INVALID_CREATION_KEY" });
  }
  if (afterChapterId !== undefined && (!Number.isInteger(afterChapterId) || afterChapterId < 1)) {
    return res.status(400).json({ message: "Invalid section to insert after" });
  }
  if (!title || content === null || !CHAPTER_TYPES.has(type)) {
    return res.status(400).json({ message: "Valid title, type, and content (maximum 5 MB) are required" });
  }

  try {
    const creationHash = createHash("sha256").update(JSON.stringify({ title, type, content, afterChapterId })).digest("hex");
    const chapter = await withEditableBook(bookId, req.userId, async (tx) => {
      // withEditableBook already locks the book row against submissions and
      // concurrent additions. The operation key makes ambiguous retries safe.
      if (creationKey) {
        const previous = await tx.bookChapter.findUnique({ where: { bookId_creationKey: { bookId, creationKey } } });
        if (previous) {
          if (previous.creationHash !== creationHash) throw new Error("CREATION_KEY_REUSED");
          return previous;
        }
      }
      // Chapter bodies can be megabytes. Ordering needs identifiers only.
      const existing = await tx.bookChapter.findMany({ where: { bookId }, select: { id: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
      const insertion = afterChapterId === undefined ? existing.length : existing.findIndex(item => item.id === afterChapterId) + 1;
      if (afterChapterId !== undefined && insertion === 0) throw new Error("PRECEDING_SECTION_MISSING");
      // Normalize legacy gaps/duplicate positions and shift the insertion tail
      // in one database round trip. Do not touch manuscript text or updatedAt.
      await tx.$executeRaw`
        WITH ordered AS (
          SELECT id, (ROW_NUMBER() OVER (ORDER BY position, "createdAt", id) - 1)::integer AS ordinal
          FROM "BookChapter" WHERE "bookId" = ${bookId}
        )
        UPDATE "BookChapter" AS chapter
        SET position = ordered.ordinal + CASE WHEN ordered.ordinal >= ${insertion} THEN 1 ELSE 0 END
        FROM ordered
        WHERE chapter.id = ordered.id
          AND chapter.position <> ordered.ordinal + CASE WHEN ordered.ordinal >= ${insertion} THEN 1 ELSE 0 END`;
      return tx.bookChapter.create({ data: { bookId, title, type, content, position: insertion, creationKey, creationHash: creationKey ? creationHash : null } });
    });
    return res.status(201).json(chapter);
  } catch (error: any) {
    if (sendAccessError(error, res)) return;
    if (error?.message === "PRECEDING_SECTION_MISSING") return res.status(409).json({ message: "The chapter list changed. Refresh the list before adding another chapter.", code: "CHAPTER_LIST_CHANGED" });
    if (error?.message === "CREATION_KEY_REUSED") return res.status(409).json({ message: "Please refresh the chapter list before starting another chapter.", code: "CREATION_KEY_REUSED" });
    console.error("addChapter error:", { code: error?.code || "CHAPTER_CREATE_ERROR", bookId });
    return res.status(503).json({ message: "We couldn't add your chapter right now. Please try again in a moment.", code: "CHAPTER_CREATE_UNAVAILABLE", retryable: true });
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
    return res.json(await withEditableBook(existing.bookId, req.userId, tx => tx.bookChapter.update({ where: { id }, data })));
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
    await withEditableBook(existing.bookId, req.userId, tx => tx.bookChapter.delete({ where: { id } }));
    return res.json({ message: "Chapter deleted" });
  } catch (error) {
    if (sendAccessError(error, res)) return;
    console.error("deleteChapter error:", error);
    return res.status(500).json({ message: "Failed to delete chapter" });
  }
};
