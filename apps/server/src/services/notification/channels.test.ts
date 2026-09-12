// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

import { channelAvailability, sendNotificationChannel } from './channels';

const env = vi.hoisted(() => ({
  email: {
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'sender@example.com',
    SMTP_PASS: 'secret',
    EMAIL_SERVICE_PROVIDER: 'nodemailer',
  },
  sms: {
    SMS_SERVICE_PROVIDER: 'tencentcloud',
    TENCENTCLOUD_SMS_REGION: 'ap-guangzhou',
    TENCENTCLOUD_SMS_SECRET_ID: 'id',
    TENCENTCLOUD_SMS_SECRET_KEY: 'key',
    TENCENTCLOUD_SMS_SDK_APP_ID: 'app',
    TENCENTCLOUD_SMS_SIGN_NAME: '旅游群',
    TENCENTCLOUD_SMS_NOTIFICATION_TEMPLATE_ID: undefined as string | undefined,
  },
}));
const mail = vi.hoisted(() => vi.fn(async (_payload: unknown) => ({ messageId: 'mail-1' })));
vi.mock('@/envs/email', () => ({ emailEnv: env.email }));
vi.mock('@/envs/sms', () => ({ smsEnv: env.sms }));
vi.mock('@/server/services/email', () => ({
  EmailService: class {
    sendMail = mail;
  },
}));
beforeEach(() => {
  env.sms.TENCENTCLOUD_SMS_NOTIFICATION_TEMPLATE_ID = undefined;
  vi.unstubAllGlobals();
  mail.mockClear();
});
it('does not reuse the authentication template for notification SMS', async () => {
  expect(channelAvailability().sms).toBe(false);
  await expect(
    sendNotificationChannel('sms', { to: '+8613812345678', title: '图片生成完成' }),
  ).rejects.toThrow('CHANNEL_UNAVAILABLE');
});
it('sends the fixed notification template without variables and verifies the provider result', async () => {
  env.sms.TENCENTCLOUD_SMS_NOTIFICATION_TEMPLATE_ID = '2726660';
  const fetcher = vi.fn(async () =>
    Response.json({ Response: { SendStatusSet: [{ Code: 'Ok', SerialNo: 'sms-1' }] } }),
  );
  vi.stubGlobal('fetch', fetcher);
  expect(
    await sendNotificationChannel('sms', { to: '+8613812345678', title: '图片生成完成' }),
  ).toEqual({ messageId: 'sms-1' });
  const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(request[0]).toBe('https://sms.tencentcloudapi.com');
  expect(JSON.parse(String(request[1].body))).toMatchObject({
    TemplateId: '2726660',
    TemplateParamSet: [],
    PhoneNumberSet: ['+8613812345678'],
  });
});
it('rejects provider rejection instead of reporting a sent SMS', async () => {
  env.sms.TENCENTCLOUD_SMS_NOTIFICATION_TEMPLATE_ID = '2726660';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ Response: { SendStatusSet: [{ Code: 'FailedOperation' }] } }),
    ),
  );
  await expect(
    sendNotificationChannel('sms', { to: '+8613812345678', title: '图片生成完成' }),
  ).rejects.toThrow('SMS_DELIVERY_FAILED');
});
it('sends a plain-text email without task content or arbitrary recipients', async () => {
  await sendNotificationChannel('email', { to: 'verified@example.com', title: '计划任务成功' });
  expect(mail).toHaveBeenCalledWith({
    to: 'verified@example.com',
    subject: '旅游群 · 计划任务成功',
    text: '您有一条计划任务成功通知。请登录旅游群，在通知中心查看详情。',
  });
});
