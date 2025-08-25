import { Request, Response } from "express";
import { buildObjectKey, getPresignedPutUrl, deleteObjectByKey } from "../services/s3.service";

type PresignBody = {
  fileName?: string;
  fileType?: string;
  folder?: string;
};

type DeleteBody = {
  key?: string;
};

export async function presignUpload(req: Request<unknown, unknown, PresignBody>, res: Response) {
  try {
    const { fileName, fileType, folder = "uploads" } = req.body || {};

    if (!fileName || !fileType) {
      return res.status(400).json({ error: "fileName and fileType are required" });
    }
    if (!fileType.startsWith("image/")) {
      return res.status(400).json({ error: "Only image uploads are allowed" });
    }

    const key = buildObjectKey(fileName, folder);
    const { uploadUrl, fileUrl } = await getPresignedPutUrl({
      key,
      contentType: fileType,
      expiresIn: 60,
    });
    console.log(uploadUrl);
    return res.json({ uploadUrl, fileUrl, key });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create presigned URL" });
  }
}

export async function deleteObject(req: Request<unknown, unknown, DeleteBody>, res: Response) {
  try {
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: "key is required" });

    await deleteObjectByKey(key);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to delete object" });
  }
}
