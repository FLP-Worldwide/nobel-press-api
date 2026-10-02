import { Router } from "express";
import { presignUpload, deleteObject, signGetUrl } from "../controllers/s3.controller";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

router.post("/presign", authMiddleware, presignUpload); // -> { uploadUrl, fileUrl, key }
router.delete("/object", authMiddleware, deleteObject); // body: { key }
router.get("/sign-get-url", authMiddleware, signGetUrl);

export default router;
