import { OrderKind, PaymentMethod, Prisma, ShippingMethod } from "@prisma/client";
import prisma from "../utils/prisma";
import { calculateOrderLine } from "../utils/commerce";

export interface DeliveryDetails {
  name: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export function validateDelivery(value: unknown): DeliveryDetails {
  if (!value || typeof value !== "object") throw new Error("Complete delivery details are required");
  const input = value as Record<string, unknown>;
  const limits: Record<string, number> = { name: 160, email: 254, phone: 30, addressLine1: 300, city: 120, state: 120, postalCode: 20, country: 120 };
  const delivery: Record<string, string> = {};
  for (const [field, max] of Object.entries(limits)) {
    if (typeof input[field] !== "string" || !input[field].trim() || input[field].trim().length > max) {
      throw new Error("Complete delivery details are required");
    }
    delivery[field] = input[field].trim();
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(delivery.email)) throw new Error("Enter a valid delivery email");
  if (!/^[+\d\s().-]{7,30}$/.test(delivery.phone)) throw new Error("Enter a valid delivery phone number");
  if (!["IN", "INDIA"].includes(delivery.country.toUpperCase())) throw new Error("Delivery is currently available within India only");
  if (!/^\d{6}$/.test(delivery.postalCode)) throw new Error("Enter a valid six-digit Indian PIN code");
  delivery.country = "India";
  if (input.addressLine2 != null && typeof input.addressLine2 !== "string") throw new Error("Invalid address");
  if (typeof input.addressLine2 === "string") {
    if (input.addressLine2.length > 300) throw new Error("Address is too long");
    delivery.addressLine2 = input.addressLine2.trim();
  }
  return delivery as unknown as DeliveryDetails;
}

export function scopedCheckoutKey(raw: unknown, userId: number, kind: OrderKind): string {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_.:-]{8,128}$/.test(raw)) {
    throw new Error("A valid checkout key is required. Refresh checkout and try again.");
  }
  return `${userId}:${kind}:${raw}`;
}

// Serializable transactions prevent double checkout / payment attempts. Retrying
// the whole read-and-write operation also resolves concurrent idempotency keys.
export async function serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error: any) {
      if (attempt >= 3 || !["P2034", "P2002"].includes(error?.code)) throw error;
    }
  }
}

export function assertSameCheckout(order: any, delivery: DeliveryDetails, paymentMethod: PaymentMethod, shippingMethod: ShippingMethod) {
  const fields: Record<string, string | undefined> = {
    customerName: delivery.name, customerEmail: delivery.email, customerPhone: delivery.phone,
    addressLine1: delivery.addressLine1, addressLine2: delivery.addressLine2, city: delivery.city,
    state: delivery.state, postalCode: delivery.postalCode, country: delivery.country,
    paymentMethod, shippingMethod,
  };
  if (Object.entries(fields).some(([key, value]) => (order[key] || "") !== (value || ""))) {
    throw new Error("Checkout details changed. Start a new checkout before paying.");
  }
}

export function deliverySnapshot(delivery: DeliveryDetails) {
  return { customerName: delivery.name, customerEmail: delivery.email, customerPhone: delivery.phone,
    addressLine1: delivery.addressLine1, addressLine2: delivery.addressLine2 || null, city: delivery.city,
    state: delivery.state, postalCode: delivery.postalCode, country: delivery.country };
}

interface CheckoutRequest {
  userId: number;
  delivery: DeliveryDetails;
  paymentMethod: PaymentMethod;
  shippingMethod: ShippingMethod;
  checkoutKey: string;
}

export const createOrder = async (data: CheckoutRequest) => {
  const { delivery, paymentMethod, shippingMethod, userId, checkoutKey } = data;
  return serializable(async (tx) => {
    const existing = await tx.order.findUnique({ where: { checkoutKey }, include: { items: true, payments: true } });
    if (existing) {
      if (existing.userId !== userId || existing.kind !== "RETAIL") throw new Error("Invalid checkout key");
      assertSameCheckout(existing, delivery, paymentMethod, shippingMethod);
      return existing;
    }
    const cart = await tx.cart.findUnique({
      where: { userId }, include: { items: { include: { book: { include: {
        reviews: { where: { status: "APPROVED" }, orderBy: { reviewedAt: "desc" }, take: 1 },
      } } } } },
    });
    if (!cart || cart.items.length === 0) throw new Error("Cart is empty");

    const pricedItems = cart.items.map((item) => {
      if (item.book.status !== "PUBLISHED" || item.book.deletedAt || !item.book.reviews[0]) {
        throw new Error(`Book ${item.bookId} is unavailable for purchase`);
      }
      if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 100) throw new Error("Invalid cart quantity");
      return { bookId: item.bookId, qty: item.qty, ...calculateOrderLine(item.book, item.qty, "RETAIL"),
        revisionId: item.book.reviews[0].revisionId, cartItemId: item.id, cartItemUpdatedAt: item.updatedAt };
    });
    const subtotal = pricedItems.reduce((total, item) => total.plus(item.lineTotal), new Prisma.Decimal(0));
    if (subtotal.lte(0)) throw new Error("Order total must be positive");
    const shippingCharge = new Prisma.Decimal(shippingMethod === "EXPRESS" ? 149 : 79);
    const total = subtotal.plus(shippingCharge);
    return tx.order.create({
      data: {
        userId, checkoutKey, kind: "RETAIL", currency: "INR", subtotal, savings: 0, storePickup: 0,
        shippingCharge, tax: 0, totalPrice: total, totalQty: cart.items.reduce((sum, item) => sum + item.qty, 0),
        paymentMethod, shippingMethod, ...deliverySnapshot(delivery), items: { create: pricedItems },
        payments: { create: { userId, amount: total, method: paymentMethod, status: "PENDING", currency: "INR" } },
      },
      include: { items: true, payments: true },
    });
  });
};
