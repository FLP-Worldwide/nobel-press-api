import { Router } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../utils/prisma";
import { AuthRequest, authMiddleware, roleMiddleware } from "../middleware/authMiddleware";

const router = Router();
router.use(authMiddleware, roleMiddleware("author"));
router.get("/dashboard", async (req: AuthRequest, res) => {
  res.set("Cache-Control", "no-store");
  try {
    // Revenue and earnings use the purchased snapshots, including archived titles.
    // Payments and author copies follow exactly the same eligibility as retail badges.
    const rows = await prisma.$queryRaw<Array<{ bookId: number; title: string; copies: bigint; earnings: string; revenue: string; missing: bigint }>>`
      SELECT i."bookId", b.title, SUM(i.qty)::bigint AS copies,
        COALESCE(SUM(i."authorEarnings" * i.qty), 0)::text AS earnings,
        SUM(i."lineTotal")::text AS revenue,
        COUNT(*) FILTER (WHERE i."authorEarnings" IS NULL)::bigint AS missing
      FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId" JOIN "Book" b ON b.id = i."bookId"
      WHERE b."userId" = ${req.userId!} AND o.kind = 'RETAIL'
        AND o.status IN ('PAID', 'PRINTING', 'SHIPPED', 'DELIVERED')
        AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p.status = 'PAID' AND p.provider = 'PHONEPE' AND p."providerRef" IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p.status = 'REFUNDED')
      GROUP BY i."bookId", b.title ORDER BY SUM(i.qty) DESC, i."bookId" ASC`;
    const decimalSum = (key: "earnings" | "revenue") => rows.reduce((sum, row) => sum.plus(row[key]), new Prisma.Decimal(0)).toFixed(2);
    return res.json({ generatedAt: new Date().toISOString(), currency: "INR", period: "all_time",
      retailCopiesSold: rows.reduce((sum, row) => sum + Number(row.copies), 0),
      accruedEarnings: decimalSum("earnings"), retailBookRevenue: decimalSum("revenue"),
      missingEarningsSnapshots: rows.reduce((sum, row) => sum + Number(row.missing), 0),
      books: rows.map(row => ({ bookId: row.bookId, title: row.title, copies: Number(row.copies), earnings: row.earnings, revenue: row.revenue })),
    });
  } catch { return res.status(503).json({ message: "Sales and earnings are temporarily unavailable" }); }
});
export default router;
