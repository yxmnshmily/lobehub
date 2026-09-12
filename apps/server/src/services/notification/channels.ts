import { emailEnv } from '@/envs/email';
import { smsEnv } from '@/envs/sms';
import { EmailService } from '@/server/services/email';
import { buildTencentCloudSmsTemplateRequest } from '@/server/services/sms/tencentcloud';

export const channelAvailability = () => ({
  email:
    emailEnv.EMAIL_SERVICE_PROVIDER === 'resend'
      ? Boolean(emailEnv.RESEND_API_KEY && emailEnv.RESEND_FROM)
      : Boolean(emailEnv.SMTP_HOST && emailEnv.SMTP_USER && emailEnv.SMTP_PASS),
  sms:
    smsEnv.SMS_SERVICE_PROVIDER === 'tencentcloud' &&
    Boolean(
      smsEnv.TENCENTCLOUD_SMS_SECRET_ID &&
      smsEnv.TENCENTCLOUD_SMS_SECRET_KEY &&
      smsEnv.TENCENTCLOUD_SMS_SDK_APP_ID &&
      smsEnv.TENCENTCLOUD_SMS_SIGN_NAME &&
      smsEnv.TENCENTCLOUD_SMS_NOTIFICATION_TEMPLATE_ID,
    ),
});

export async function sendNotificationChannel(
  channel: 'email' | 'sms',
  payload: { to: string; title: string },
) {
  if (!channelAvailability()[channel]) throw new Error('CHANNEL_UNAVAILABLE');
  if (channel === 'email') {
    return new EmailService().sendMail({
      to: payload.to,
      subject: `旅游群 · ${payload.title}`,
      text: `您有一条${payload.title}通知。请登录旅游群，在通知中心查看详情。`,
    });
  }
  const request = buildTencentCloudSmsTemplateRequest({
    config: {
      region: smsEnv.TENCENTCLOUD_SMS_REGION,
      secretId: smsEnv.TENCENTCLOUD_SMS_SECRET_ID!,
      secretKey: smsEnv.TENCENTCLOUD_SMS_SECRET_KEY!,
      sdkAppId: smsEnv.TENCENTCLOUD_SMS_SDK_APP_ID!,
      signName: smsEnv.TENCENTCLOUD_SMS_SIGN_NAME!,
      templateId: smsEnv.TENCENTCLOUD_SMS_NOTIFICATION_TEMPLATE_ID!,
    },
    phoneNumber: payload.to,
    // The approved service-notification template is fixed text and accepts no variables.
    templateParams: [],
    timestamp: Math.floor(Date.now() / 1000),
  });
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(10_000),
  });
  const result = (await response.json()) as {
    Response?: { Error?: unknown; SendStatusSet?: { Code?: string; SerialNo?: string }[] };
  };
  const sent = result.Response?.SendStatusSet?.[0];
  if (!response.ok || result.Response?.Error || sent?.Code !== 'Ok')
    throw new Error('SMS_DELIVERY_FAILED');
  return { messageId: sent.SerialNo ?? '' };
}
