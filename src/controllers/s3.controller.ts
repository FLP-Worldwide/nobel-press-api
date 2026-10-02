import { Request, Response } from "express";
import { buildObjectKey, getPresignedPutUrl, deleteObjectByKey, getPresignedGetUrl } from "../services/s3.service";
import { AuthRequest } from "../middleware/authMiddleware";

type PresignBody = {
  fileName?: string;
  fileType?: string;
  folder?: string;
};

type DeleteBody = {
  key?: string;
};

export async function presignUpload(req: AuthRequest, res: Response) {
  try {
    const { fileName, fileType } = req.body || {};
    if (!req.userId) return res.status(401).json({ error: "Unauthorized" });

    if (!fileName || !fileType) {
      return res.status(400).json({ error: "fileName and fileType are required" });
    }
    if (!fileType.startsWith("image/")) {
      return res.status(400).json({ error: "Only image uploads are allowed" });
    }

    const key = buildObjectKey(fileName, `users/${req.userId}/uploads`);
    const { uploadUrl, fileUrl } = await getPresignedPutUrl({
      key,
      contentType: fileType,
      expiresIn: 60,
    });
    return res.json({ uploadUrl, fileUrl, key });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create presigned URL" });
  }
}

export async function deleteObject(req: AuthRequest, res: Response) {
  try {
    const { key } = req.body || {};
    if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
    if (!key) return res.status(400).json({ error: "key is required" });
    if (req.role !== "admin" && !key.startsWith(`users/${req.userId}/`)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await deleteObjectByKey(key);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to delete object" });
  }
}

export async function signGetUrl(req: AuthRequest, res: Response) {
  try {
    const key = String(req.query.key || "");
    if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
    if (!key) return res.status(400).json({ error: "key is required" });
    if (req.role !== "admin" && !key.startsWith(`users/${req.userId}/`)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { url } = await getPresignedGetUrl({ key, expiresIn: 300 });
    return res.json({ url });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Failed to sign GET URL" });
  }
}
