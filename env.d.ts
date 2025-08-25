declare namespace NodeJS {
    interface ProcessEnv {
      PORT?: string;
      AWS_REGION: string;
      AWS_ACCESS_KEY_ID: string;
      AWS_SECRET_ACCESS_KEY: string;
      S3_BUCKET: string;
      ALLOWED_ORIGIN?: string; // comma-separated list allowed
    }
  }
  