import { Router } from "express";
import {
    createBook,
    getAllBooks,
    getBookById,
    upsertBookDesign,
    getBookDesign,
    deleteBookDesign,
} from "../controllers/bookController";
import { authMiddleware, roleMiddleware } from "../middleware/authMiddleware";

const router = Router();

/* =========================
   Book routes
   ========================= */
router.post("/",authMiddleware,roleMiddleware("author"),createBook); // only authors can create

router.get("/", getAllBooks); // everyone
router.get("/:id", getBookById); // everyone

/* =========================
   BookDesign routes
   ========================= */
router.put("/:bookId/design",authMiddleware,roleMiddleware("author"),upsertBookDesign); // author can create/update

router.get("/:bookId/design", getBookDesign); // everyone can view design

router.delete("/:bookId/design",authMiddleware,roleMiddleware("author"),deleteBookDesign); // author can delete

export default router;
