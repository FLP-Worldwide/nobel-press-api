import { Router } from "express";
import {
   createBook,
   getBookById,
   upsertBookDesign,
   getBookDesign,
   deleteBookDesign,
   getUserBooks,
   updateBook,
   updateBookCovers,
   deleteBook,
   getAllBooks
} from "../controllers/bookController";
import { authMiddleware, roleMiddleware } from "../middleware/authMiddleware";

const router = Router();

/* =========================
   Book routes
   ========================= */

router.get('/all',getAllBooks); // public route to get all books
router.post("/", authMiddleware, roleMiddleware("author"), createBook); // only authors can create
router.get("/", authMiddleware, roleMiddleware("author"), getUserBooks);
router.put("/:id", authMiddleware, updateBook); // only authors can update their own books
router.get("/:id", authMiddleware, roleMiddleware("author"), getBookById); // everyone
router.patch("/:id/covers", authMiddleware, updateBookCovers);
router.delete("/:id", authMiddleware, roleMiddleware("author"), deleteBook); // only authors can delete their own books

/* =========================
   BookDesign routes
   ========================= */
router.put("/:bookId/design", authMiddleware, roleMiddleware("author"), upsertBookDesign); // author can create/update

router.get("/:bookId/design", authMiddleware, getBookDesign); // everyone can view design

router.delete("/:bookId/design", authMiddleware, roleMiddleware("author"), deleteBookDesign); // author can delete

export default router;
