import express from "express";
import cors from "cors"

import authRoutes from "./routes/authRoutes";
import bookRoutes from "./routes/bookRoutes";
import chapterRoutes from "./routes/chapterRoutes";
import s3Routes from "./routes/s3.routes";
import checkoutRoutes from "./routes/checkoutRoutes";
import paymentsRoutes from "./routes/payments";
import reviewRoutes from "./routes/reviewRoutes";
import orderRoutes from "./routes/orderRoutes";
import adminRoutes from "./routes/adminRoutes";
import authorRoutes from "./routes/authorRoutes";

import cartRoute from './routes/cartRoutes';
import cookieParser from "cookie-parser";
import { guestSession } from "./middleware/guestSession";
import { corsOptions } from "./config/cors";
import prisma from "./utils/prisma";
import { assertDatabaseUrl, getDatabaseUrl } from "./config/database";

const app = express();
app.use(cors(corsOptions()));
// Liveness works without a database connection and never sets a guest cookie.
app.get(["/", "/api", "/api/health"], (_req, res) => {
    res.set("Cache-Control", "no-store").json({ status: "ok", service: "nobel-press-api" });
});
app.get("/api/health/ready", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    const missing = [!getDatabaseUrl() && "DATABASE_URL", !process.env.JWT_SECRET?.trim() && "JWT_SECRET"].filter(Boolean);
    if (missing.length) {
        console.error(`API configuration missing: ${missing.join(", ")}`);
        return res.status(503).json({ status: "unavailable", message: "API configuration is incomplete" });
    }
    try {
        assertDatabaseUrl(getDatabaseUrl(), Boolean(process.env.VERCEL));
        await prisma.$queryRaw`SELECT 1`;
        return res.json({ status: "ok", database: "connected" });
    } catch (error: any) {
        console.error("API database readiness failed", error?.code || error?.name || "DatabaseError");
        return res.status(503).json({ status: "unavailable", message: "Database connection failed" });
    }
});
app.use(express.json({ limit: "6mb" }));
app.use(cookieParser());
app.use(guestSession());
// Routes
app.use("/api/auth", authRoutes);
app.use("/api/books", bookRoutes);
app.use("/api/chapters", chapterRoutes);
app.use("/api/s3", s3Routes);
app.use('/api/cart', cartRoute);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/author", authorRoutes);

app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.type === "entity.too.large") {
        return res.status(413).json({ message: "Request is too large. Use smaller images or reduce the content size." });
    }
    if (err?.type === "entity.parse.failed") {
        return res.status(400).json({ message: "Request body must contain valid JSON" });
    }
    if (res.headersSent) return next(err);
    console.error("Unhandled API error", err?.code || err?.name || "Error");
    return res.status(500).json({ message: "An unexpected server error occurred" });
});


export default app;

// Vercel imports the app; only the local/server command opens a port.
if (require.main === module && !process.env.VERCEL) {
    const PORT = Number(process.env.PORT || 5000);
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
