import express from "express";
import cors from "cors"

import authRoutes from "./routes/authRoutes";
import bookRoutes from "./routes/bookRoutes";
import chapterRoutes from "./routes/chapterRoutes";
import s3Routes from "./routes/s3.routes";
import checkoutRoutes from "./routes/checkoutRoutes";

import cartRoute from './routes/cartRoutes';
import cookieParser from "cookie-parser";
import { guestSession } from "./middleware/guestSession";

const app = express();
app.use(cors())

app.use(
    cors({
        origin: (process.env.ALLOWED_ORIGIN?.split(",") || ["*"]),
        credentials: true,
    })
);
app.use(express.json());
app.use(cookieParser());
app.use(guestSession());
// Routes
app.use("/api/auth", authRoutes);
app.use("/api/books", bookRoutes);
app.use("/api/chapters", chapterRoutes);
app.use("/api/s3", s3Routes);
app.use('/api/cart', cartRoute);
app.use("/api/checkout", checkoutRoutes);



const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
