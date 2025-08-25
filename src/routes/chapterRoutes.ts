import { Router } from "express";
import { addChapter, getChaptersByBook } from "../controllers/chapterController";
import { authMiddleware, roleMiddleware } from "../middleware/authMiddleware";

const router = Router({ mergeParams: true });

router.post("/:bookId", authMiddleware, roleMiddleware("author"), addChapter); // only authors
router.get("/:bookId", getChaptersByBook);                                     // everyone

export default router;
