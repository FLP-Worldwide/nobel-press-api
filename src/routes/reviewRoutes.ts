import { Router } from "express";
import {
  approveReview,
  getReviewById,
  listReviews,
  rejectReview,
  requestReviewChanges,
} from "../controllers/reviewController";
import { authMiddleware, roleMiddleware } from "../middleware/authMiddleware";

const router = Router();
router.use(authMiddleware, roleMiddleware("admin"));
router.get("/", listReviews);
router.get("/:id", getReviewById);
router.post("/:id/approve", approveReview);
router.post("/:id/request-changes", requestReviewChanges);
router.post("/:id/reject", rejectReview);

export default router;
