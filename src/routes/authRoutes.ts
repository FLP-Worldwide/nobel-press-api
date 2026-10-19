import { Router } from "express";
import { signup, login, adminLogin, getProfile } from "../controllers/authController";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/admin/login", adminLogin);
router.get("/profile", authMiddleware, getProfile);

export default router;
