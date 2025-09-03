import { PrismaClient, PaymentMethod, ShippingMethod } from "@prisma/client";

const prisma = new PrismaClient();

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
  paymentMethod: PaymentMethod;   // COD | CARD | UPI | PAYPAL
  shippingMethod: ShippingMethod; // STANDARD | EXPRESS
}

export const createOrder = async (data: CheckoutRequest) => {
  const { delivery, paymentMethod, shippingMethod, userId } = data;
  console.log("🛒 Creating order for user:", userId);

  // 🔎 Cart fetch
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: true },
  });

  if (!cart || cart.items.length === 0) {
    throw new Error("Cart is empty");
  }

  // 🧾 Calculate summary
  const subtotal = cart.items.reduce(
    (acc, item) => acc + Number(item.price) * item.qty,
    0
  );
  const savings = 0;
  const storePickup = 0;
  const tax = 0;
  const total = subtotal - savings + storePickup + tax;

  // 🛍 Create order
  const order = await prisma.order.create({
    data: {
      userId,
      subtotal,
      savings,
      storePickup,
      tax,
      totalPrice: total,
      totalQty: cart.totalQty,
      paymentMethod,
      shippingMethod,

      // snapshot delivery
      customerName: delivery.name,
      customerEmail: delivery.email,
      customerPhone: delivery.phone,
      addressLine1: delivery.addressLine1,
      addressLine2: delivery.addressLine2,
      city: delivery.city,
      state: delivery.state,
      postalCode: delivery.postalCode,
      country: delivery.country,

      items: {
        create: cart.items.map((item) => ({
          bookId: item.bookId,
          unitPrice: item.price,
          qty: item.qty,
          lineTotal: Number(item.price) * item.qty,
        })),
      },

      payments: {
        create: {
          userId,
          amount: total,
          method: paymentMethod,
          status: "PENDING",
        },
      },
    },
    include: { items: true, payments: true },
  });

  // 🗑 Empty cart
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  await prisma.cart.delete({
    where: { id: cart.id },
  });

  return order;
};
