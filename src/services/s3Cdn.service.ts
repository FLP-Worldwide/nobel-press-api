import { PutObjectCommand as CfPutObjectCommand, DeleteObjectCommand as CfDeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl as getS3SignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 as cfS3 } from "../config/s3.client";


const CF_BUCKET = process.env.S3_BUCKET!;
const CDN_DOMAIN = process.env.CDN_DOMAIN!; // e.g. cdn.yourdomain.com


export function cfBuildObjectKey(fileName: string, folder = "uploads"): string {
    const safeName = (fileName ?? "file").replace(/[^\w.\-()]/g, "_");
    return `${folder}/${Date.now()}-${safeName}`;
}


export function getCdnUrlFromKey(key: string): string {
    return `https://${CDN_DOMAIN}/${key}`;
}


export async function cfGetPresignedPutUrl(opts: {
    key: string;
    contentType: string;
    expiresIn?: number; // seconds
}): Promise<{ uploadUrl: string; fileUrl: string }> {
    const { key, contentType, expiresIn = 60 } = opts;


    const cmd = new CfPutObjectCommand({
        Bucket: CF_BUCKET,
        Key: key,
        ContentType: contentType,
    });


    const uploadUrl = await getS3SignedUrl(cfS3, cmd, { expiresIn });
    const fileUrl = getCdnUrlFromKey(key);


    return { uploadUrl, fileUrl };
}


export async function cfDeleteObjectByKey(key: string): Promise<void> {
    await cfS3.send(new CfDeleteObjectCommand({ Bucket: CF_BUCKET, Key: key }));
}



// Optional: CloudFront Signed URL helper(requires`@aws-sdk/cloudfront-signer`)


// import { getSignedUrl as getCfSignedUrl } from "@aws-sdk/cloudfront-signer";


// export function getSignedCdnUrl(key: string, expiresInSeconds = 300) {
//     const url = getCdnUrlFromKey(key);
//     return getCfSignedUrl({
//         url,
//         keyPairId: process.env.CF_KEY_PAIR_ID!,
//         privateKey: process.env.CF_PRIVATE_KEY!, // PEM
//         dateLessThan: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
//     });
// }
