import { Router } from "express";
import { presignUpload, deleteObject } from "../controllers/s3.controller";

const router = Router();

router.post("/presign", presignUpload); // -> { uploadUrl, fileUrl, key }
router.delete("/object", deleteObject); // body: { key }

export default router;
