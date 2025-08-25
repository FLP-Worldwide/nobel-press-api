import { Request, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../utils/prisma";
import { generateToken } from "../utils/auth";

export const signup = async (req: Request, res: Response) => {
  const { name, email, password, phone, role } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, phone, role, password: hashedPassword },
    });

    const token = generateToken(user.id);
    res.json({ user, token });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(400).json({ message: "Email already exists" });
    }
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: "Invalid credentials" });

    const token = generateToken(user.id);
    res.json({ user, token });
  } catch (err) {
    res.status(500).json({ message: "Something went wrong" });
  }
};

export const getProfile = async (req: any, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Something went wrong" });
  }
};
