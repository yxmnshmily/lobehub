import { describe, expect, it } from 'vitest';

import { scanPlatformContent } from './index';

describe('scanPlatformContent', () => {
  it('allows ordinary tourism requests without retaining the original content', () => {
    const result = scanPlatformContent({ text: '帮我制作一篇西藏旅游文案' });

    expect(result.action).toBe('allow');
    expect(result.findings).toEqual([]);
    expect(result.preview).toBe('帮我制作一篇西藏旅游文案');
    expect(result.fingerprint).toMatch(/^[a-f\d]{64}$/);
    expect(result).not.toHaveProperty('text');
  });

  it('marks personal contact information for review and returns only redacted metadata', () => {
    const result = scanPlatformContent({
      text: '联系邮箱 guest@example.com，手机 13812345678，身份证 11010519491231002X',
    });

    expect(result.action).toBe('review');
    expect(result.findings).toEqual([
      { category: 'email', count: 1, severity: 'medium' },
      { category: 'phone', count: 1, severity: 'medium' },
      { category: 'government_id', count: 1, severity: 'high' },
    ]);
    expect(result.preview).not.toContain('guest@example.com');
    expect(result.preview).not.toContain('13812345678');
    expect(result.preview).not.toContain('11010519491231002X');
    expect(result.preview).toContain('[EMAIL]');
    expect(result.preview).toContain('[PHONE]');
    expect(result.preview).toContain('[GOVERNMENT_ID]');
  });

  it('blocks credential disclosure without returning the secret value', () => {
    const secret = 'sk-live-abcdefghijklmnopqrstuvwxyz123456';
    const result = scanPlatformContent({ text: `OPENAI_API_KEY=${secret}` });

    expect(result.action).toBe('block');
    expect(result.findings).toEqual([{ category: 'credential', count: 1, severity: 'critical' }]);
    expect(result.preview).toBe('OPENAI_[CREDENTIAL]');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('treats provider moderation as a blocking signal while preserving safe audit metadata', () => {
    const result = scanPlatformContent({
      providerModeration: { code: 'ContentModeration', source: 'model-provider' },
      text: '普通旅游需求',
    });

    expect(result.action).toBe('block');
    expect(result.findings).toEqual([
      { category: 'provider_moderation', count: 1, severity: 'high' },
    ]);
    expect(result.providerSignal).toEqual({
      code: 'ContentModeration',
      source: 'model-provider',
    });
  });
});
