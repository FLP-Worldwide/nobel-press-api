import { Router } from "express";
import { addChapter, getChaptersByBook, updateChapter } from "../controllers/chapterController";
import { authMiddleware, roleMiddleware } from "../middleware/authMiddleware";

const router = Router({ mergeParams: true });

router.post("/:bookId", authMiddleware, roleMiddleware("author"), addChapter); // only authors
router.get("/:bookId", getChaptersByBook);                                     // everyone
router.put("/:id", authMiddleware, roleMiddleware("author"), updateChapter)

export default router;
