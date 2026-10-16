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
   ,getPublicBookById
   ,restoreBook
} from "../controllers/bookController";
import { authMiddleware, roleMiddleware } from "../middleware/authMiddleware";
import { getBookReviewStatus, submitBookForReview, startBookRevision } from "../controllers/reviewController";
import {
  getPublishingPaymentStatus,
  initiatePublishingPayment,
} from "../controllers/publishingPaymentController";
import { createAuthorCopyOrder, quoteAuthorCopies } from "../controllers/authorCopyController";

import { saveCoverDesign } from "../controllers/coverDesignController";

import { getPricing, publishBook } from "../controllers/pricingController";

const router = Router();
router.get("/:id/pricing", authMiddleware, roleMiddleware("author", "admin"), getPricing);
router.post("/:id/publish", authMiddleware, roleMiddleware("author"), publishBook);

/* =========================
   Book routes
   ========================= */

router.get('/all',getAllBooks); // public route to get all books
router.get('/public/:id', getPublicBookById);
router.post("/:id/revise", authMiddleware, roleMiddleware("author"), startBookRevision);
router.post("/", authMiddleware, roleMiddleware("author"), createBook); // only authors can create
router.get("/", authMiddleware, roleMiddleware("author", "admin"), getUserBooks);
router.put("/:id", authMiddleware, roleMiddleware("author"), updateBook);
router.get("/:id", authMiddleware, roleMiddleware("author", "admin"), getBookById);
router.put("/:id/cover-design", authMiddleware, roleMiddleware("author"), saveCoverDesign);
router.patch("/:id/covers", authMiddleware, roleMiddleware("author"), updateBookCovers);
router.post("/:id/submit-review", authMiddleware, roleMiddleware("author"), submitBookForReview);
router.get("/:id/review-status", authMiddleware, roleMiddleware("author", "admin"), getBookReviewStatus);
router.post("/:id/publishing-payment/initiate", authMiddleware, roleMiddleware("author"), initiatePublishingPayment);
router.get("/:id/publishing-payment/status", authMiddleware, roleMiddleware("author", "admin"), getPublishingPaymentStatus);
router.post("/:id/author-copies/quote", authMiddleware, roleMiddleware("author"), quoteAuthorCopies);
router.post("/:id/author-copies/orders", authMiddleware, roleMiddleware("author"), createAuthorCopyOrder);
router.delete("/:id", authMiddleware, roleMiddleware("author"), deleteBook); // only authors can delete their own books
router.post("/:id/restore", authMiddleware, roleMiddleware("author"), restoreBook);

/* =========================
   BookDesign routes
   ========================= */
router.put("/:bookId/design", authMiddleware, roleMiddleware("author"), upsertBookDesign); // author can create/update

router.get("/:bookId/design", authMiddleware, getBookDesign); // everyone can view design

router.delete("/:bookId/design", authMiddleware, roleMiddleware("author"), deleteBookDesign); // author can delete

export default router;
