import { S3Client, S3ClientConfig } from "@aws-sdk/client-s3";

const config: S3ClientConfig = {
  region: process.env.AWS_REGION || "ap-south-1",
};

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  config.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

export const s3 = new S3Client(config);
