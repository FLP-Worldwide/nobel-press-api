import prisma from "../utils/prisma";
import { verifiedRetailWhere } from "../utils/commerce";
export async function withSales<T extends { id: number }>(books: T[]) {
  if (!books.length) return [];
  const counts = await prisma.orderItem.groupBy({ by: ["bookId"], where: {
    bookId: { in: books.map(book => book.id) }, order: verifiedRetailWhere(),
  }, _sum: { qty: true } });
  const sales = new Map(counts.map(row => [row.bookId, row._sum.qty || 0]));
  return books.map(book => { const retailCopiesSold = sales.get(book.id) || 0;
    return { ...book, retailCopiesSold, salesBadge: retailCopiesSold >= 1000 ? "Bestseller" : null }; });
}
