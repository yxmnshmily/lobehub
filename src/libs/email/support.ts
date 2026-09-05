import { BRANDING_EMAIL } from '@lobechat/business-const';

interface EmailSupportCopy {
  contactSupport?: string;
}

const DEFAULT_SUPPORT_COPY = {
  contactSupport: '联系旅游群网',
} satisfies Required<EmailSupportCopy>;

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const EMAIL_SUPPORT_ADDRESS = BRANDING_EMAIL.support;
export const EMAIL_SUPPORT_REPLY_TO = BRANDING_EMAIL.replyTo;

export const getEmailSupportHtml = ({
  contactSupport = DEFAULT_SUPPORT_COPY.contactSupport,
}: EmailSupportCopy = {}) => {
  const supportEmail = escapeHtml(EMAIL_SUPPORT_ADDRESS);
  const businessEmail = escapeHtml(BRANDING_EMAIL.business);

  return `${escapeHtml(contactSupport)}：<a href="mailto:${supportEmail}" style="color: #6b7280; text-decoration: underline;">${supportEmail}</a><span style="color: #a1a1aa;"> · </span><a href="mailto:${businessEmail}" style="color: #6b7280; text-decoration: underline;">${businessEmail}</a>`;
};

export const getEmailSupportText = ({
  contactSupport = DEFAULT_SUPPORT_COPY.contactSupport,
}: EmailSupportCopy = {}) =>
  `${contactSupport}：${EMAIL_SUPPORT_ADDRESS}、${BRANDING_EMAIL.business}`;
