import type { CorsOptions } from "cors";

export function corsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  const defaults = env.NODE_ENV === "production"
    ? ["https://nobelbooks.vercel.app"]
    : ["http://localhost:3000", "http://127.0.0.1:3000"];
  const entries = env.ALLOWED_ORIGIN?.trim()
    ? env.ALLOWED_ORIGIN.split(",")
    : defaults;
  const origins = new Set<string>();
  for (const entry of entries) {
    try {
      const url = new URL(entry.trim());
      // Credentialed requests require exact origins, never a wildcard.
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
          url.pathname !== "/" || url.search || url.hash) continue;
      origins.add(url.origin);
    } catch {
      // Invalid entries grant no access. Other valid entries still work.
    }
  }
  return {
    origin: [...origins],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
    maxAge: 600,
  };
}
