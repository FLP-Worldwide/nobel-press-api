import { Router } from "express";
import { createBook, getAllBooks, getBookById } from "../controllers/bookController";
import { authMiddleware, roleMiddleware } from "../middleware/authMiddleware";

const router = Router();

router.post("/", authMiddleware, roleMiddleware("author"), createBook); // only authors
router.get("/", getAllBooks);                                           // everyone
router.get("/:id", getBookById);                                        // everyone

export default router;
