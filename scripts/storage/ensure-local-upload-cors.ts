import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';

// Browser uploads need CORS in addition to valid S3 signatures.
const client = new S3Client({
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: process.env.S3_ENABLE_PATH_STYLE === '1',
  region: process.env.S3_REGION || 'us-east-1',
});
const Bucket = process.env.S3_BUCKET;
const ID = 'travel-local-browser-upload';
let rules;
try {
  rules = (await client.send(new GetBucketCorsCommand({ Bucket }))).CORSRules ?? [];
} catch (error) {
  if (!(error instanceof Error) || error.name !== 'NoSuchCORSConfiguration') throw error;
  rules = [];
}
await client.send(
  new PutBucketCorsCommand({
    Bucket,
    CORSConfiguration: {
      CORSRules: [
        ...rules.filter((rule) => rule.ID !== ID),
        {
          ID,
          AllowedOrigins: [
            'http://localhost:3010',
            'http://127.0.0.1:3010',
            'http://localhost:3011',
            'http://localhost:9876',
          ],
          AllowedMethods: ['GET', 'HEAD', 'PUT'],
          AllowedHeaders: ['content-type', 'x-amz-*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);
console.log('本地浏览器上传 CORS 已配置');
