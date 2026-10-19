import { Request, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../utils/prisma";
import { generateToken } from "../utils/auth";
import { AuthRequest } from "../middleware/authMiddleware";

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  verified: true,
  role: true,
  createdAt: true,
} as const;

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export const signup = async (req: Request, res: Response) => {
  const name = cleanString(req.body?.name);
  const email = cleanString(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const phone = cleanString(req.body?.phone) || null;
  // Public registration supports author and reader accounts only.
  // Arbitrary roles are never accepted from the request;
  // admins are provisioned only through a trusted operational process.
  const role = req.body?.accountType === "buyer" ? "buyer" : "author";

  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ message: "A valid name and email are required" });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ message: "Password must be between 8 and 128 characters" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, phone, role, password: hashedPassword },
      select: publicUserSelect,
    });

    const token = generateToken(user.id);
    return res.status(201).json({ user, token });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ message: "Email already exists" });
    }
    console.error("signup error:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

const loginFor = (adminOnly: boolean) => async (req: Request, res: Response) => {
  const email = cleanString(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const storedUser = await prisma.user.findUnique({ where: { email } });
    if (!storedUser) return res.status(401).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, storedUser.password);
    if (!match) return res.status(401).json({ message: "Invalid credentials" });

    if (adminOnly && storedUser.role !== "admin") {
      return res.status(403).json({ message: "This sign in is for administrators only" });
    }
    if (!adminOnly && storedUser.role === "admin") {
      return res.status(403).json({ message: "Use Admin sign in for this account" });
    }
    if (!adminOnly && req.body?.accountType && req.body.accountType !== storedUser.role) {
      return res.status(403).json({ message: storedUser.role === "buyer" ? "Use Reader sign in for this account" : "Use Author sign in for this account" });
    }

    const { password: _password, ...user } = storedUser;
    const token = generateToken(user.id);
    return res.json({ user, token });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};

export const login = loginFor(false);
export const adminLogin = loginFor(true);

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: publicUserSelect,
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json({ user });
  } catch (err) {
    console.error("getProfile error:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};
