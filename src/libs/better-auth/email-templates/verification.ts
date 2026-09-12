import {
  AUTH_EMAIL_BRAND_NAME,
  escapeEmailHtml,
  getTravelGroupEmailFooterText,
  renderTravelGroupAuthEmail,
  travelGroupLogoAttachment,
} from './auth-brand';

/** Sent after signup when a customer needs to verify their email address. */
export const getVerificationEmailTemplate = ({
  expiresInSeconds,
  url,
  userName,
}: {
  expiresInSeconds: number;
  url: string;
  userName?: string | null;
}) => {
  const safeUrl = escapeEmailHtml(url);
  const safeUserName = userName ? escapeEmailHtml(userName) : null;
  const expiresInMinutes = Math.max(1, Math.round(expiresInSeconds / 60));
  const expirationText =
    expiresInMinutes >= 60 && expiresInMinutes % 60 === 0
      ? `${expiresInMinutes / 60} 小时`
      : `${expiresInMinutes} 分钟`;

  return {
    attachments: [travelGroupLogoAttachment],
    html: renderTravelGroupAuthEmail({
      content: `
        ${safeUserName ? `<p style="margin:0 0 16px;font-size:16px;line-height:26px;color:#222222;">你好，<strong>${safeUserName}</strong>：</p>` : ''}
        <p style="margin:0 0 24px;font-size:16px;line-height:28px;color:#222222;">感谢注册${AUTH_EMAIL_BRAND_NAME}。请点击下方按钮确认这是你的邮箱地址。</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:32px auto;"><tr><td bgcolor="#222222" style="border-radius:10px;"><a href="${safeUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:16px;line-height:22px;font-weight:600;">验证邮箱并继续</a></td></tr></table>
        <div style="margin:0 0 24px;padding:14px 16px;background:#fbfbfb;border-radius:10px;font-size:14px;line-height:22px;text-align:center;color:#666666;">验证链接将在 <strong style="color:#222222;">${expirationText}</strong> 后失效。</div>
        <p style="margin:0 0 24px;font-size:14px;line-height:24px;color:#666666;">如果不是你本人注册，可直接忽略这封邮件。</p>
        <div style="margin:28px 0 20px;border-top:0.5px solid #eeeeee;"></div>
        <p style="margin:0 0 8px;font-size:13px;line-height:21px;color:#999999;">按钮无法打开时，请复制以下链接到浏览器：</p>
        <a href="${safeUrl}" style="display:block;color:#0072f5;font-size:13px;line-height:20px;text-decoration:none;word-break:break-all;">${safeUrl}</a>`,
      title: '验证你的邮箱',
    }),
    subject: `请验证你的邮箱｜${AUTH_EMAIL_BRAND_NAME}`,
    text: `${userName ? `你好，${userName}：\n\n` : ''}感谢注册${AUTH_EMAIL_BRAND_NAME}。请打开以下链接验证邮箱：\n${url}\n\n链接将在 ${expirationText} 后失效。\n\n如果不是你本人注册，可忽略这封邮件。\n\n${getTravelGroupEmailFooterText()}`,
  };
};
