import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      SMS_SERVICE_PROVIDER?: string;
      TENCENTCLOUD_SMS_REGION?: string;
      TENCENTCLOUD_SMS_SDK_APP_ID?: string;
      TENCENTCLOUD_SMS_SECRET_ID?: string;
      TENCENTCLOUD_SMS_SECRET_KEY?: string;
      TENCENTCLOUD_SMS_SIGN_NAME?: string;
      TENCENTCLOUD_SMS_TEMPLATE_ID?: string;
    }
  }
}

export const getSmsConfig = () =>
  createEnv({
    runtimeEnv: {
      SMS_SERVICE_PROVIDER: process.env.SMS_SERVICE_PROVIDER?.toLowerCase(),
      TENCENTCLOUD_SMS_REGION: process.env.TENCENTCLOUD_SMS_REGION,
      TENCENTCLOUD_SMS_SDK_APP_ID: process.env.TENCENTCLOUD_SMS_SDK_APP_ID,
      TENCENTCLOUD_SMS_SECRET_ID: process.env.TENCENTCLOUD_SMS_SECRET_ID,
      TENCENTCLOUD_SMS_SECRET_KEY: process.env.TENCENTCLOUD_SMS_SECRET_KEY,
      TENCENTCLOUD_SMS_SIGN_NAME: process.env.TENCENTCLOUD_SMS_SIGN_NAME,
      TENCENTCLOUD_SMS_TEMPLATE_ID: process.env.TENCENTCLOUD_SMS_TEMPLATE_ID,
    },
    server: {
      SMS_SERVICE_PROVIDER: z.enum(['tencentcloud']).optional(),
      TENCENTCLOUD_SMS_REGION: z.string().optional().default('ap-guangzhou'),
      TENCENTCLOUD_SMS_SDK_APP_ID: z.string().optional(),
      TENCENTCLOUD_SMS_SECRET_ID: z.string().optional(),
      TENCENTCLOUD_SMS_SECRET_KEY: z.string().optional(),
      TENCENTCLOUD_SMS_SIGN_NAME: z.string().optional(),
      TENCENTCLOUD_SMS_TEMPLATE_ID: z.string().optional(),
    },
  });

export const smsEnv = getSmsConfig();
