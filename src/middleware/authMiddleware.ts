import { Request, Response, NextFunction } from "express";
import prisma from "../utils/prisma";
import { verifyToken } from "../utils/auth";

export interface AuthRequest extends Request {
  userId?: number;
  role?: string;
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, role: true },
    });
    if (!user) return res.status(401).json({ message: "Invalid token" });

    req.userId = user.id;
    req.role = user.role;
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
};

export const roleMiddleware = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userId || !req.role) return res.status(401).json({ message: "Unauthorized" });
    if (!allowedRoles.includes(req.role)) {
      return res.status(403).json({ message: "Forbidden: Access denied" });
    }
    return next();
  };
};
