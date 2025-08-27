import { PutObjectCommand, DeleteObjectCommand, PutObjectCommandInput, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../config/s3.client";


const BUCKET = process.env.S3_BUCKET!;
const REGION = process.env.AWS_REGION!;
const USE_OBJECT_ACL = process.env.USE_OBJECT_ACL === "true"; // only if bucket allows ACLs


export function buildObjectKey(fileName: string, folder = "uploads"): string {
  const safeName = (fileName ?? "file").replace(/[^\w.\-()]/g, "_");
  return `${folder}/${Date.now()}-${safeName}`;
}


export function getS3PublicUrl(key: string): string {
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}


export async function getPresignedPutUrl(opts: {
  key: string;
  contentType: string;
  expiresIn?: number; // seconds
}): Promise<{ uploadUrl: string; fileUrl: string; requiresAclHeader: boolean }> {
  const { key, contentType, expiresIn = 60 } = opts;


  const params: PutObjectCommandInput = {
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  };


  if (USE_OBJECT_ACL) {
    params.ACL = "public-read";
  }


  const cmd = new PutObjectCommand(params);
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn });
  const fileUrl = getS3PublicUrl(key);


  return { uploadUrl, fileUrl, requiresAclHeader: USE_OBJECT_ACL };
}

export async function deleteObjectByKey(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function getPresignedGetUrl(opts: {
  key: string;
  expiresIn?: number;         // seconds (default 300)
  downloadName?: string;      // optional: force browser download with a filename
}): Promise<{ url: string }> {
  const { key, expiresIn = 300, downloadName } = opts;

  // Optional: set ResponseContentDisposition to suggest a download filename
  const ResponseContentDisposition = downloadName
    ? `inline; filename="${downloadName.replace(/"/g, "")}"`
    : undefined;

  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(ResponseContentDisposition ? { ResponseContentDisposition } : {}),
  });

  const url = await getSignedUrl(s3, cmd, { expiresIn });
  return { url };
}
