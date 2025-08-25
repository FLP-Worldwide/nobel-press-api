import express from "express";
import cors from "cors"

import authRoutes from "./routes/authRoutes";
import bookRoutes from "./routes/bookRoutes";
import chapterRoutes from "./routes/chapterRoutes";
import s3Routes from "./routes/s3.routes";

const app = express();
app.use(cors())

// app.use(
//     cors({
//         origin: (process.env.ALLOWED_ORIGIN?.split(",") || ["*"]),
//         credentials: true,
//     })
// );
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/books", bookRoutes);
app.use("/api/chapters", chapterRoutes);
app.use("/s3", s3Routes);

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
