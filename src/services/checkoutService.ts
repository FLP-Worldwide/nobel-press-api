import { PaymentMethod, Prisma, ShippingMethod } from "@prisma/client";
import prisma from "../utils/prisma";

interface DeliveryDetails {
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

interface CheckoutRequest {
  userId: number;
  delivery: DeliveryDetails;
  paymentMethod: PaymentMethod;
  shippingMethod: ShippingMethod;
}

export const createOrder = async (data: CheckoutRequest) => {
  const { delivery, paymentMethod, shippingMethod, userId } = data;
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({
      where: { userId },
      include: { items: { include: { book: true } } },
    });
    if (!cart || cart.items.length === 0) throw new Error("Cart is empty");

    let subtotal = new Prisma.Decimal(0);
    let totalQty = 0;
    const pricedItems = cart.items.map((item) => {
      const price = item.book.retailPrice;
      if (item.book.status !== "PUBLISHED" || item.book.deletedAt || !price || price.lte(0)) {
        throw new Error(`Book ${item.bookId} is unavailable for purchase`);
      }
      if (item.qty < 1 || item.qty > 100) throw new Error("Invalid cart quantity");
      const lineTotal = price.mul(item.qty);
      subtotal = subtotal.plus(lineTotal);
      totalQty += item.qty;
      return { bookId: item.bookId, unitPrice: price, qty: item.qty, lineTotal };
    });
    if (subtotal.lte(0)) throw new Error("Order total must be positive");
    const shippingCharge = new Prisma.Decimal(shippingMethod === "EXPRESS" ? 149 : 79);
    const total = subtotal.plus(shippingCharge);

    const order = await tx.order.create({
      data: {
        userId,
        kind: "RETAIL",
        subtotal,
        savings: new Prisma.Decimal(0),
        storePickup: new Prisma.Decimal(0),
        shippingCharge,
        tax: new Prisma.Decimal(0),
        totalPrice: total,
        totalQty,
        paymentMethod,
        shippingMethod,
        customerName: delivery.name,
        customerEmail: delivery.email,
        customerPhone: delivery.phone,
        addressLine1: delivery.addressLine1,
        addressLine2: delivery.addressLine2,
        city: delivery.city,
        state: delivery.state,
        postalCode: delivery.postalCode,
        country: delivery.country,
        items: { create: pricedItems },
        payments: {
          create: { userId, amount: total, method: paymentMethod, status: "PENDING" },
        },
      },
      include: { items: true, payments: true },
    });
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    await tx.cart.delete({ where: { id: cart.id } });
    return order;
  });
};
