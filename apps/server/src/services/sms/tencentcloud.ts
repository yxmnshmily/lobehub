import { createHash, createHmac } from 'node:crypto';

const HOST = 'sms.tencentcloudapi.com';
const SERVICE = 'sms';

export interface TencentCloudSmsConfig {
  region: string;
  sdkAppId: string;
  secretId: string;
  secretKey: string;
  signName: string;
  templateId: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const hmac = (key: Buffer | string, value: string) =>
  createHmac('sha256', key).update(value).digest();

export const normalizeChinesePhoneNumber = (input: string): string => {
  const compact = input.replaceAll(/[\s()-]/g, '');
  const normalized = compact.startsWith('+86')
    ? compact
    : compact.startsWith('86')
      ? `+${compact}`
      : `+86${compact}`;
  if (!/^\+861[3-9]\d{9}$/.test(normalized)) throw new Error('INVALID_PHONE_NUMBER');
  return normalized;
};

export const isCanonicalChinesePhoneNumber = (input: string) => /^\+861[3-9]\d{9}$/.test(input);

export const buildTencentCloudSmsTemplateRequest = ({
  templateParams,
  config,
  phoneNumber,
  timestamp,
}: {
  templateParams: string[];
  config: TencentCloudSmsConfig;
  phoneNumber: string;
  timestamp: number;
}) => {
  const body = JSON.stringify({
    PhoneNumberSet: [normalizeChinesePhoneNumber(phoneNumber)],
    SignName: config.signName,
    SmsSdkAppId: config.sdkAppId,
    TemplateId: config.templateId,
    TemplateParamSet: templateParams,
  });
  const canonicalHeaders =
    'content-type:application/json; charset=utf-8\nhost:sms.tencentcloudapi.com\nx-tc-action:sendsms\n';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(body)}`;
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256(canonicalRequest)}`;
  const secretDate = hmac(`TC3${config.secretKey}`, date);
  const secretService = hmac(secretDate, SERVICE);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

  return {
    body,
    headers: {
      'Authorization': `TC3-HMAC-SHA256 Credential=${config.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'Content-Type': 'application/json; charset=utf-8',
      'Host': HOST,
      'X-TC-Action': 'SendSms',
      'X-TC-Region': config.region,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': '2021-01-11',
    },
    url: `https://${HOST}`,
  };
};

export const buildTencentCloudSmsRequest = (input: {
  code: string;
  config: TencentCloudSmsConfig;
  phoneNumber: string;
  timestamp: number;
}) => buildTencentCloudSmsTemplateRequest({ ...input, templateParams: [input.code, '5'] });
