import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import prisma from "../utils/prisma";

const orderInclude = {
  items: {
    include: {
      book: {
        select: { id: true, title: true, authorName: true, frontCoverUrl: true },
      },
    },
  },
  payments: {
    select: { id: true, amount: true, method: true, status: true, provider: true, paidAt: true, createdAt: true },
  },
} as const;

export const getMyOrders = async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.userId },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
    });
    return res.json({ orders });
  } catch (error) {
    console.error("getMyOrders error:", error);
    return res.status(500).json({ message: "Failed to fetch orders" });
  }
};

export const getOrderById = async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid order id" });
  if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (req.role !== "admin" && order.userId !== req.userId) return res.status(403).json({ message: "Forbidden" });
    return res.json({ order });
  } catch (error) {
    console.error("getOrderById error:", error);
    return res.status(500).json({ message: "Failed to fetch order" });
  }
};
