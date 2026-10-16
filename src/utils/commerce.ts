import { OrderKind, Prisma } from "@prisma/client";

const D = Prisma.Decimal;
const rounded = (value: Prisma.Decimal) => value.toDecimalPlaces(2, D.ROUND_HALF_UP);
export function money(value: unknown): Prisma.Decimal {
  if ((typeof value !== "string" && typeof value !== "number" && !D.isDecimal(value)) ||
      !/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error("Enter a positive amount with at most two decimal places");
  const result = new D(String(value));
  if (!result.isFinite() || result.lte(0) || result.gt(100000)) throw new Error("Amount must be between ₹0.01 and ₹100,000");
  return result;
}

export function getBookPricing(book: { printCost?: any; retailPrice?: any; pageCount?: number | null }) {
  if (!book.printCost || !book.pageCount) throw new Error("Admin must confirm printing cost and page count first");
  const printCost = money(book.printCost);
  const minimumSellingPrice = printCost.div("0.7").toDecimalPlaces(2, D.ROUND_CEIL);
  const price = book.retailPrice ? money(book.retailPrice) : null;
  const commission = price ? rounded(price.minus(printCost).mul("0.25")) : null;
  return { currency: "INR", pageCount: book.pageCount, printCost: printCost.toNumber(),
    minimumSellingPrice: minimumSellingPrice.toNumber(), retailPrice: price?.toNumber() ?? null,
    commissionPercent: 25, platformCommission: commission?.toNumber() ?? null,
    authorEarnings: price && commission ? price.minus(printCost).minus(commission).toNumber() : null,
    authorCopyDiscountPercent: 30, authorCopyMinQty: 5,
    authorCopyPrice: price ? rounded(price.mul("0.7")).toNumber() : null };
}

export function calculateOrderLine(book: any, qty: number, kind: OrderKind) {
  const pricing = getBookPricing(book);
  if (!Number.isInteger(qty) || qty < (kind === "AUTHOR_COPY" ? pricing.authorCopyMinQty : 1) || qty > 100) throw new Error("Invalid order quantity");
  const price = money(book.retailPrice);
  if (price.lt(pricing.minimumSellingPrice)) throw new Error("The selling price must cover discounted author-copy printing costs");
  const unitPrice = kind === "AUTHOR_COPY" ? rounded(price.mul("0.7")) : price;
  return { title: book.title, unitPrice, lineTotal: unitPrice.mul(qty), printCost: new D(pricing.printCost),
    platformCommission: kind === "RETAIL" ? new D(pricing.platformCommission!) : new D(0),
    authorEarnings: kind === "RETAIL" ? new D(pricing.authorEarnings!) : new D(0) };
}

export function verifiedRetailWhere() {
  return { kind: "RETAIL" as const, status: { in: ["PAID", "PRINTING", "SHIPPED", "DELIVERED"] as any },
    payments: { some: { status: "PAID" as const, provider: "PHONEPE", providerRef: { not: null } },
      none: { status: "REFUNDED" as const } } };
}
