import {
  AUTH_EMAIL_BRAND_NAME,
  escapeEmailHtml,
  getTravelGroupEmailFooterText,
  renderTravelGroupAuthEmail,
  travelGroupLogoAttachment,
} from './auth-brand';

/** Sent when a customer requests a password reset. */
export const getResetPasswordEmailTemplate = ({ url }: { url: string }) => {
  const safeUrl = escapeEmailHtml(url);

  return {
    attachments: [travelGroupLogoAttachment],
    html: renderTravelGroupAuthEmail({
      content: `
        <p style="margin:0 0 24px;font-size:16px;line-height:28px;color:#222222;">我们收到了你的密码重置申请。请点击下方按钮设置新密码。</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:32px auto;"><tr><td bgcolor="#222222" style="border-radius:10px;"><a href="${safeUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:16px;line-height:22px;font-weight:600;">重置密码</a></td></tr></table>
        <p style="margin:0 0 24px;font-size:14px;line-height:24px;color:#666666;">如果不是你本人操作，可直接忽略这封邮件，原密码不会改变。</p>
        <div style="margin:28px 0 20px;border-top:0.5px solid #eeeeee;"></div>
        <p style="margin:0 0 8px;font-size:13px;line-height:21px;color:#999999;">按钮无法打开时，请复制以下链接到浏览器：</p>
        <a href="${safeUrl}" style="display:block;color:#0072f5;font-size:13px;line-height:20px;text-decoration:none;word-break:break-all;">${safeUrl}</a>`,
      title: '重置你的密码',
    }),
    subject: `重置密码｜${AUTH_EMAIL_BRAND_NAME}`,
    text: `请打开以下链接重置${AUTH_EMAIL_BRAND_NAME}账号密码：\n${url}\n\n如果不是你本人操作，可忽略这封邮件。\n\n${getTravelGroupEmailFooterText()}`,
  };
};
