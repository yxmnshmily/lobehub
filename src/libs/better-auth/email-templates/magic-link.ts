import {
  AUTH_EMAIL_BRAND_NAME,
  escapeEmailHtml,
  getTravelGroupEmailFooterText,
  renderTravelGroupAuthEmail,
  travelGroupLogoAttachment,
} from './auth-brand';

/** Sent when a customer requests passwordless login. */
export const getMagicLinkEmailTemplate = ({
  expiresInSeconds,
  url,
}: {
  expiresInSeconds: number;
  url: string;
}) => {
  const safeUrl = escapeEmailHtml(url);
  const expirationText = `${Math.max(1, Math.round(expiresInSeconds / 60))} 分钟`;

  return {
    attachments: [travelGroupLogoAttachment],
    html: renderTravelGroupAuthEmail({
      content: `
        <p style="margin:0 0 24px;font-size:16px;line-height:28px;color:#222222;">请点击下方按钮登录你的${AUTH_EMAIL_BRAND_NAME}账号。</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:32px auto;"><tr><td bgcolor="#222222" style="border-radius:10px;"><a href="${safeUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:16px;line-height:22px;font-weight:600;">登录${AUTH_EMAIL_BRAND_NAME}</a></td></tr></table>
        <div style="margin:0 0 24px;padding:14px 16px;background:#fbfbfb;border-radius:10px;font-size:14px;line-height:22px;text-align:center;color:#666666;">登录链接将在 <strong style="color:#222222;">${expirationText}</strong> 后失效。</div>
        <p style="margin:0 0 24px;font-size:14px;line-height:24px;color:#666666;">如果不是你本人申请，可直接忽略这封邮件。</p>
        <div style="margin:28px 0 20px;border-top:1px solid #eeeeee;"></div>
        <p style="margin:0 0 8px;font-size:13px;line-height:21px;color:#999999;">按钮无法打开时，请复制以下链接到浏览器：</p>
        <a href="${safeUrl}" style="display:block;color:#0072f5;font-size:13px;line-height:20px;text-decoration:none;word-break:break-all;">${safeUrl}</a>`,
      title: '登录你的账号',
    }),
    subject: `登录链接｜${AUTH_EMAIL_BRAND_NAME}`,
    text: `请打开以下链接登录${AUTH_EMAIL_BRAND_NAME}：\n${url}\n\n链接将在 ${expirationText} 后失效。\n\n${getTravelGroupEmailFooterText()}`,
  };
};
