import { BookStatus, Prisma } from "@prisma/client";
import prisma from "./prisma";

export const EDITABLE_BOOK_STATUSES: BookStatus[] = [
  BookStatus.DRAFT,
  BookStatus.CHANGES_REQUESTED,
];

export function isEditableBookStatus(status: BookStatus): boolean {
  return EDITABLE_BOOK_STATUSES.includes(status);
}

export async function requireOwnedBook(bookId: number, userId: number) {
  const book = await prisma.book.findFirst({
    where: { id: bookId, deletedAt: null },
  });
  if (!book) throw new Error("NOT_FOUND");
  if (book.userId !== userId) throw new Error("FORBIDDEN");
  return book;
}

export async function requireOwnedEditableBook(bookId: number, userId: number) {
  const book = await requireOwnedBook(bookId, userId);
  if (!isEditableBookStatus(book.status)) throw new Error("BOOK_LOCKED");
  return book;
}

export function accessErrorResponse(error: unknown): { status: number; message: string } | null {
  const code = error instanceof Error ? error.message : "";
  if (code === "NOT_FOUND") return { status: 404, message: "Book not found" };
  if (code === "FORBIDDEN") return { status: 403, message: "Forbidden" };
  if (code === "BOOK_LOCKED") {
    return {
      status: 409,
      message: "This book is locked while it is under review, approved, or published",
    };
  }
  return null;
}

// All manuscript mutations lock the book row shared with submission. Updating
// updatedAt makes an already-read submission snapshot fail its optimistic check.
export async function withEditableBook<T>(bookId: number, userId: number, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Book" WHERE id = ${bookId} FOR UPDATE`;
    const book = await tx.book.findFirst({ where: { id: bookId, deletedAt: null } });
    if (!book) throw new Error("NOT_FOUND");
    if (book.userId !== userId) throw new Error("FORBIDDEN");
    if (!isEditableBookStatus(book.status)) throw new Error("BOOK_LOCKED");
    await tx.book.update({ where: { id: bookId }, data: { updatedAt: new Date() } });
    return operation(tx);
  });
}
