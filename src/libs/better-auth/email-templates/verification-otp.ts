import {
  AUTH_EMAIL_BRAND_NAME,
  escapeEmailHtml,
  getTravelGroupEmailFooterText,
  renderTravelGroupAuthEmail,
  travelGroupLogoAttachment,
} from './auth-brand';

/** Sent when a customer verifies an email address with a one-time code. */
export const getVerificationOTPEmailTemplate = ({
  expiresInSeconds,
  otp,
  userName,
}: {
  expiresInSeconds: number;
  otp: string;
  userName?: string | null;
}) => {
  const safeOtp = escapeEmailHtml(otp);
  const safeUserName = userName ? escapeEmailHtml(userName) : null;
  const expirationText = `${Math.max(1, Math.round(expiresInSeconds / 60))} 分钟`;

  return {
    attachments: [travelGroupLogoAttachment],
    html: renderTravelGroupAuthEmail({
      content: `
        ${safeUserName ? `<p style="margin:0 0 16px;font-size:16px;line-height:26px;color:#222222;">你好，<strong>${safeUserName}</strong>：</p>` : ''}
        <p style="margin:0 0 24px;font-size:16px;line-height:28px;color:#222222;">请在${AUTH_EMAIL_BRAND_NAME}页面输入以下验证码，完成邮箱验证。</p>
        <div style="margin:32px 0;padding:22px;text-align:center;background:#222222;border-radius:12px;color:#ffffff;font-family:'Courier New',monospace;font-size:36px;font-weight:700;letter-spacing:10px;">${safeOtp}</div>
        <div style="margin:0 0 24px;padding:14px 16px;background:#fbfbfb;border-radius:10px;font-size:14px;line-height:22px;text-align:center;color:#666666;">验证码将在 <strong style="color:#222222;">${expirationText}</strong> 后失效。</div>
        <p style="margin:0;font-size:14px;line-height:24px;color:#666666;">如果不是你本人申请，请不要把验证码告诉任何人，并直接忽略这封邮件。</p>`,
      title: '验证你的邮箱',
    }),
    subject: `邮箱验证码｜${AUTH_EMAIL_BRAND_NAME}`,
    text: `你的${AUTH_EMAIL_BRAND_NAME}邮箱验证码是：${otp}\n\n验证码将在 ${expirationText} 后失效，请勿转发。\n\n${getTravelGroupEmailFooterText()}`,
  };
};
