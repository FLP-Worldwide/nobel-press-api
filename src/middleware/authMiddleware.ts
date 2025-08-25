import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/auth";

export interface AuthRequest extends Request {
  userId?: number;
  role?: string;
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    // Optional: get role from database
    // We’ll fetch role in controller when needed
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

// Middleware to check for specific role(s)
export const roleMiddleware = (...allowedRoles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const prisma = (await import("../utils/prisma")).default;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ message: "Forbidden: Access denied" });
    }

    req.role = user.role;
    next();
  };
};
