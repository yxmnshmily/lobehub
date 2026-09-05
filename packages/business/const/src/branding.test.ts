import { describe, expect, it } from 'vitest';

import { BRANDING_EMAIL } from './branding';

describe('BRANDING_EMAIL', () => {
  it('uses the travel service contact mailboxes', () => {
    expect(BRANDING_EMAIL).toEqual({
      business: 'jinwang1016@163.com',
      replyTo: 'yxmnshmily@qq.com',
      support: 'yxmnshmily@qq.com',
    });
  });
});
