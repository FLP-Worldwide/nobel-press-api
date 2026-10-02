import jwt from "jsonwebtoken";

function jwtSecret(): string {
  const configured = process.env.JWT_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production");
  }
  return "local-development-secret-change-before-production";
}

// Generate JWT
export const generateToken = (userId: number) => {
  return jwt.sign({ userId }, jwtSecret(), { expiresIn: "7d" });
};

// Verify JWT
export const verifyToken = (token: string) => {
  return jwt.verify(token, jwtSecret(), { algorithms: ["HS256"] }) as { userId: number };
};
