import { BRANDING_EMAIL } from '@lobechat/business-const';
import { describe, expect, it } from 'vitest';

import {
  EMAIL_SUPPORT_ADDRESS,
  EMAIL_SUPPORT_REPLY_TO,
  getEmailSupportHtml,
  getEmailSupportText,
} from './support';

describe('email support helpers', () => {
  it('renders actionable support links for HTML and plain-text emails', () => {
    const html = getEmailSupportHtml();
    const text = getEmailSupportText();

    expect(EMAIL_SUPPORT_ADDRESS).toBe(BRANDING_EMAIL.support);
    expect(EMAIL_SUPPORT_REPLY_TO).toBe(BRANDING_EMAIL.replyTo);
    expect(html).toContain(`href="mailto:${BRANDING_EMAIL.support}"`);
    expect(html).toContain(`href="mailto:${BRANDING_EMAIL.business}"`);
    expect(text).toContain(BRANDING_EMAIL.support);
    expect(text).toContain(BRANDING_EMAIL.business);
  });

  it('escapes localized labels before rendering HTML', () => {
    const html = getEmailSupportHtml({
      contactSupport: '<script>alert("support")</script>',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
