import { resolveBookReference } from "../middleware/bookReference";
import { Router } from "express";
import { addChapter, getChaptersByBook, updateChapter,deleteChapter } from "../controllers/chapterController";
import { authMiddleware, roleMiddleware } from "../middleware/authMiddleware";

const router = Router({ mergeParams: true });
router.param("bookId", resolveBookReference);

router.post("/:bookId", authMiddleware, roleMiddleware("author"), addChapter); // only authors
router.get("/:bookId", authMiddleware, roleMiddleware("author", "admin"), getChaptersByBook);
router.put("/:id", authMiddleware, roleMiddleware("author"), updateChapter)
router.delete("/:id", authMiddleware, roleMiddleware("author"), deleteChapter)


export default router;
