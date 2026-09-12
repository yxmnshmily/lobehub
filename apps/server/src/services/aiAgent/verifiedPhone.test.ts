// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { assertGroupAiPhoneVerified } from './verifiedPhone';

describe('group AI phone admission', () => {
  const database = (user: unknown, topic: unknown = null) => ({
    query: {
      users: { findFirst: vi.fn().mockResolvedValue(user) },
      topics: { findFirst: vi.fn().mockResolvedValue(topic) },
    },
  });

  it.each([
    undefined,
    { phone: null, phoneNumberVerified: true },
    { phone: '+8613800138000', phoneNumberVerified: false },
  ])('rejects an unverified actor before group execution', async (user) => {
    await expect(
      assertGroupAiPhoneVerified(database(user) as any, 'actor', { groupId: 'group' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('accepts a verified phone', async () => {
    await expect(
      assertGroupAiPhoneVerified(
        database({ phone: '+8613800138000', phoneNumberVerified: true }) as any,
        'actor',
        { groupId: 'group' },
      ),
    ).resolves.toBeUndefined();
  });
  it('uses the persisted topic group when the client omits groupId', async () => {
    await expect(
      assertGroupAiPhoneVerified(database(null, { groupId: 'group' }) as any, 'actor', {
        topicId: 'topic',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('does not restrict ordinary non-group chat', async () => {
    await expect(
      assertGroupAiPhoneVerified(database(null) as any, 'actor', {}),
    ).resolves.toBeUndefined();
  });
});
