import { describe, expect, it } from 'vitest';

import {
  buildTencentCloudSmsRequest,
  isCanonicalChinesePhoneNumber,
  normalizeChinesePhoneNumber,
} from './tencentcloud';

describe('normalizeChinesePhoneNumber', () => {
  it.each([
    ['13812345678', '+8613812345678'],
    ['+8613812345678', '+8613812345678'],
    ['86 138 1234 5678', '+8613812345678'],
  ])('normalizes %s to E.164', (input, expected) => {
    expect(normalizeChinesePhoneNumber(input)).toBe(expected);
  });

  it.each(['', '1381234567', '12812345678', '+86138123456789', 'not-a-phone'])(
    'rejects invalid phone number %s',
    (input) => {
      expect(() => normalizeChinesePhoneNumber(input)).toThrow('INVALID_PHONE_NUMBER');
    },
  );
});

describe('isCanonicalChinesePhoneNumber', () => {
  it('only accepts the E.164 form persisted by authentication', () => {
    expect(isCanonicalChinesePhoneNumber('+8613812345678')).toBe(true);
    expect(isCanonicalChinesePhoneNumber('13812345678')).toBe(false);
    expect(isCanonicalChinesePhoneNumber('86 138 1234 5678')).toBe(false);
  });
});

describe('buildTencentCloudSmsRequest', () => {
  it('builds a signed request without exposing the secret in headers or body', () => {
    const request = buildTencentCloudSmsRequest({
      code: '123456',
      config: {
        region: 'ap-guangzhou',
        secretId: 'test-secret-id',
        secretKey: 'test-secret-key',
        sdkAppId: '1400000000',
        signName: '旅游群网',
        templateId: '1000000',
      },
      phoneNumber: '+8613812345678',
      timestamp: 1_700_000_000,
    });

    expect(request.url).toBe('https://sms.tencentcloudapi.com');
    expect(request.headers).toMatchObject({
      'Content-Type': 'application/json; charset=utf-8',
      Host: 'sms.tencentcloudapi.com',
      'X-TC-Action': 'SendSms',
      'X-TC-Region': 'ap-guangzhou',
      'X-TC-Timestamp': '1700000000',
      'X-TC-Version': '2021-01-11',
    });
    expect(request.headers.Authorization).toContain('Credential=test-secret-id/');
    expect(JSON.parse(request.body)).toEqual({
      PhoneNumberSet: ['+8613812345678'],
      SignName: '旅游群网',
      SmsSdkAppId: '1400000000',
      TemplateId: '1000000',
      TemplateParamSet: ['123456', '5'],
    });
    expect(JSON.stringify(request)).not.toContain('test-secret-key');
  });
});
