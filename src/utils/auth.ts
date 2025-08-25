import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// Generate JWT
export const generateToken = (userId: number) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
};

// Verify JWT
export const verifyToken = (token: string) => {
  return jwt.verify(token, JWT_SECRET) as { userId: number };
};
