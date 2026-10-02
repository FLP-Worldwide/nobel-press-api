import prisma from '../utils/prisma';
import { Prisma, Cart } from '@prisma/client';
import { Principal, isUser } from '../types/principal';

const U = Prisma.validator<Prisma.CartUncheckedCreateInput>;

function whereByPrincipal(p: Principal) {
  return isUser(p) ? { userId: p.userId } : { sessionId: p.sessionId! };
}

async function recomputeTotalsTx(tx: Prisma.TransactionClient, cartId: number) {
  const items = await tx.cartItem.findMany({ where: { cartId }, select: { qty: true, price: true } });
  let totalQty = 0, totalPrice = new Prisma.Decimal(0);
  for (const it of items) {
    totalQty += it.qty;
    totalPrice = totalPrice.plus(it.price.mul(it.qty));
  }
  return tx.cart.update({ where: { id: cartId }, data: { totalQty, totalPrice } });
}

/* ---------- Single-signature helpers (no overloads) ---------- */
export function createCartForPrincipalTx(
  tx: Prisma.TransactionClient,
  p: Principal
): Promise<Cart> {
  if (isUser(p)) {
    const data = U()({ userId: p.userId, totalPrice: new Prisma.Decimal(0), totalQty: 0 });
    return tx.cart.create({ data });
  }
  const data = U()({ sessionId: p.sessionId!, totalPrice: new Prisma.Decimal(0), totalQty: 0 });
  return tx.cart.create({ data });
}

export function createCartForPrincipal(p: Principal): Promise<Cart> {
  if (isUser(p)) {
    const data = U()({ userId: p.userId, totalPrice: new Prisma.Decimal(0), totalQty: 0 });
    return prisma.cart.create({ data, include: { items: true } });
  }
  const data = U()({ sessionId: p.sessionId!, totalPrice: new Prisma.Decimal(0), totalQty: 0 });
  return prisma.cart.create({ data, include: { items: true } });
}

/* ---------- Public API ---------- */
export async function getOrCreateCart(p: Principal) {
  const existing = await prisma.cart.findFirst({
    where: whereByPrincipal(p),
    include: {
      items: { include: { book: { select: { id: true, title: true, authorName: true } } } },
    },
  });
  return existing ?? createCartForPrincipal(p); // ✅ OK: single signature
}

export async function getCart(p: Principal) {
  return getOrCreateCart(p);
}

export async function addItem(
  p: Principal,
  bookId: number,
  qty = 1,
) {
  if (!Number.isInteger(qty) || qty <= 0 || qty > 100) throw new Error('Quantity must be between 1 and 100');

  return prisma.$transaction(async (tx) => {
    const book = await tx.book.findFirst({
      where: { id: bookId, status: 'PUBLISHED', deletedAt: null, retailPrice: { gt: 0 } },
      select: { retailPrice: true },
    });
    if (!book?.retailPrice) throw new Error('Book is unavailable for purchase');
    const unit = book.retailPrice;
    let cart = await tx.cart.findFirst({ where: whereByPrincipal(p) });
    if (!cart) cart = await createCartForPrincipalTx(tx, p); // ✅ OK

    const existing = await tx.cartItem.findUnique({
      where: { cartId_bookId: { cartId: cart.id, bookId } },
    });

    if (existing) {
      if (existing.qty + qty > 100) throw new Error('Quantity must be between 1 and 100');
      await tx.cartItem.update({
        where: { cartId_bookId: { cartId: cart.id, bookId } },
        data: { qty: existing.qty + qty, price: unit },
      });
    } else {
      await tx.cartItem.create({ data: { cartId: cart.id, bookId, qty, price: unit } });
    }

    await recomputeTotalsTx(tx, cart.id);

    return tx.cart.findUnique({
      where: { id: cart.id },
      include: { items: { include: { book: { select: { id: true, title: true, authorName: true } } } } },
    });
  });
}

export async function updateItemQty(p: Principal, itemId: number, qty: number) {
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findFirst({ where: whereByPrincipal(p) });
    if (!cart) throw new Error('Cart not found');

    const item = await tx.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cartId !== cart.id) throw new Error('Item not found in your cart');

    if (qty <= 0) await tx.cartItem.delete({ where: { id: itemId } });
    else await tx.cartItem.update({ where: { id: itemId }, data: { qty } });

    await recomputeTotalsTx(tx, cart.id);
    return tx.cart.findUnique({
      where: { id: cart.id },
      include: { items: { include: { book: { select: { id: true, title: true, authorName: true } } } } },
    });
  });
}

export async function removeItem(p: Principal, itemId: number) {
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findFirst({ where: whereByPrincipal(p) });
    if (!cart) throw new Error('Cart not found');

    const item = await tx.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cartId !== cart.id) throw new Error('Item not found in your cart');

    await tx.cartItem.delete({ where: { id: itemId } });
    await recomputeTotalsTx(tx, cart.id);

    return tx.cart.findUnique({
      where: { id: cart.id },
      include: { items: { include: { book: { select: { id: true, title: true, authorName: true } } } } },
    });
  });
}

export async function clearCart(p: Principal) {
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findFirst({ where: whereByPrincipal(p) });
    if (!cart) return getOrCreateCart(p);

    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    await tx.cart.update({ where: { id: cart.id }, data: { totalQty: 0, totalPrice: new Prisma.Decimal(0) } });

    return tx.cart.findUnique({ where: { id: cart.id }, include: { items: true } });
  });
}

export async function mergeGuestCartToUser(sessionId: string, userId: number) {
  return prisma.$transaction(async (tx) => {
    const guest = await tx.cart.findFirst({ where: { sessionId } });
    if (!guest) return null;

    let userCart = await tx.cart.findFirst({ where: { userId } });
    if (!userCart) {
      const data = U()({ userId, totalPrice: new Prisma.Decimal(0), totalQty: 0 });
      userCart = await tx.cart.create({ data });
    }

    const gItems = await tx.cartItem.findMany({ where: { cartId: guest.id } });
    for (const gi of gItems) {
      const book = await tx.book.findFirst({
        where: { id: gi.bookId, status: 'PUBLISHED', deletedAt: null, retailPrice: { gt: 0 } },
        select: { retailPrice: true },
      });
      if (!book?.retailPrice) continue;
      const existing = await tx.cartItem.findUnique({
        where: { cartId_bookId: { cartId: userCart.id, bookId: gi.bookId } },
      });
      if (existing) {
        await tx.cartItem.update({
          where: { cartId_bookId: { cartId: userCart.id, bookId: gi.bookId } },
          data: { qty: existing.qty + gi.qty, price: book.retailPrice },
        });
      } else {
        await tx.cartItem.create({
          data: { cartId: userCart.id, bookId: gi.bookId, qty: gi.qty, price: book.retailPrice },
        });
      }
    }

    await tx.cartItem.deleteMany({ where: { cartId: guest.id } });
    await tx.cart.delete({ where: { id: guest.id } });
    await recomputeTotalsTx(tx, userCart.id);

    return tx.cart.findUnique({ where: { id: userCart.id }, include: { items: true } });
  });
}
