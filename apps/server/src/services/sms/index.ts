import { smsEnv } from '@/envs/sms';

import {
  buildTencentCloudSmsRequest,
  isCanonicalChinesePhoneNumber,
  type TencentCloudSmsConfig,
} from './tencentcloud';

const getConfig = (): TencentCloudSmsConfig | null => {
  const config = {
    region: smsEnv.TENCENTCLOUD_SMS_REGION,
    secretId: smsEnv.TENCENTCLOUD_SMS_SECRET_ID,
    secretKey: smsEnv.TENCENTCLOUD_SMS_SECRET_KEY,
    sdkAppId: smsEnv.TENCENTCLOUD_SMS_SDK_APP_ID,
    signName: smsEnv.TENCENTCLOUD_SMS_SIGN_NAME,
    templateId: smsEnv.TENCENTCLOUD_SMS_TEMPLATE_ID,
  };
  return Object.values(config).every(Boolean) ? (config as TencentCloudSmsConfig) : null;
};

export const isSmsAuthenticationEnabled = () =>
  smsEnv.SMS_SERVICE_PROVIDER === 'tencentcloud' && getConfig() !== null;

export const validateChinesePhoneNumber = isCanonicalChinesePhoneNumber;

export const sendAuthenticationCode = async (phoneNumber: string, code: string) => {
  const config = getConfig();
  if (smsEnv.SMS_SERVICE_PROVIDER !== 'tencentcloud' || !config)
    throw new Error('SMS_AUTH_NOT_CONFIGURED');
  const request = buildTencentCloudSmsRequest({ code, config, phoneNumber, timestamp: Math.floor(Date.now() / 1000) });
  const response = await fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  });
  const result = (await response.json()) as { Response?: { Error?: unknown; SendStatusSet?: { Code?: string }[] } };
  if (!response.ok || result.Response?.Error || result.Response?.SendStatusSet?.[0]?.Code !== 'Ok')
    throw new Error('SMS_DELIVERY_FAILED');
};
