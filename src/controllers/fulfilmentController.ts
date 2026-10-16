import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import prisma from "../utils/prisma";
import { serializable } from "../services/checkoutService";
const paidWhere = { payments: { some: { status: "PAID" as const, provider: "PHONEPE", providerRef: { not: null } }, none: { status: "REFUNDED" as const } } };
export const listFulfilment = async (_req: AuthRequest, res: Response) => {
  try {
    const orders = await prisma.order.findMany({ where: { ...paidWhere, status: { in: ["PAID", "PRINTING", "SHIPPED", "DELIVERED"] } },
      include: { items: true }, orderBy: { createdAt: "desc" }, take: 200 });
    return res.json({ orders });
  } catch { return res.status(503).json({ message: "Orders are unavailable" }); }
};
export const updateFulfilment = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid order id");
    const next = req.body?.status;
    const previous: Record<string, string> = { PRINTING: "PAID", SHIPPED: "PRINTING", DELIVERED: "SHIPPED" };
    if (!previous[next]) throw new Error("Invalid fulfilment transition");
    const tracking: any = {};
    if (next === "SHIPPED") {
      for (const key of ["carrier", "trackingNumber"]) {
        if (typeof req.body[key] !== "string" || !req.body[key].trim() || req.body[key].length > 120) throw new Error("Carrier and tracking number are required");
        tracking[key] = req.body[key].trim();
      }
      if (req.body.trackingUrl) {
        const url = new URL(req.body.trackingUrl);
        if (url.protocol !== "https:" || url.username || url.password || url.href.length > 2000) throw new Error("Tracking link must use HTTPS");
        tracking.trackingUrl = url.href;
      }
    }
    const order = await serializable(async tx => {
      const eligible = await tx.order.findFirst({ where: { id, ...paidWhere }, include: { items: true } });
      if (!eligible || eligible.status !== previous[next]) throw new Error("Only verified paid orders can advance one fulfilment stage at a time");
      if (eligible.items.some(item => !item.revisionId || item.printCost == null)) throw new Error("This legacy order needs a confirmed print revision and cost");
      return tx.order.update({ where: { id }, data: { status: next, ...tracking } });
    });
    return res.json({ order });
  } catch (error: any) { return res.status(409).json({ message: error.code ? "Order update is unavailable" : error.message }); }
};
export const getOrderProof = async (req: AuthRequest, res: Response) => {
  try {
    const item = await prisma.orderItem.findFirst({ where: { id: Number(req.params.itemId), orderId: Number(req.params.id), order: paidWhere }, include: { revision: true } });
    if (!item?.revision) return res.status(404).json({ message: "Paid order proof not found" });
    return res.json({ revision: item.revision });
  } catch { return res.status(400).json({ message: "Cannot load order proof" }); }
};
