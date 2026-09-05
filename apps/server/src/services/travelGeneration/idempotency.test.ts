import { describe, expect, it } from 'vitest';

import { deriveTravelOrderIdempotency } from './idempotency';

const base = {
  input: { prompt: '桂林旅游文案' },
  maxCredits: 80,
  orderId: '00000000-0000-4000-8000-000000000010',
  owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
  type: 'copy' as const,
};

describe('deriveTravelOrderIdempotency credit admission', () => {
  it('replays the same order, input, owner, and credit cap deterministically', () => {
    expect(deriveTravelOrderIdempotency(base)).toEqual(deriveTravelOrderIdempotency(base));
  });

  it('keeps the order key but changes the request hash when the credit cap changes', () => {
    const first = deriveTravelOrderIdempotency(base);
    const changed = deriveTravelOrderIdempotency({ ...base, maxCredits: 81 });

    expect(changed.key).toBe(first.key);
    expect(changed.requestHash).not.toBe(first.requestHash);
  });

  it('keeps the order key but changes the request hash when generation input changes', () => {
    const first = deriveTravelOrderIdempotency(base);
    const changed = deriveTravelOrderIdempotency({
      ...base,
      input: { prompt: '不同的旅游文案' },
    });

    expect(changed.key).toBe(first.key);
    expect(changed.requestHash).not.toBe(first.requestHash);
  });

  it('isolates the order key across users and workspaces', () => {
    const first = deriveTravelOrderIdempotency(base);
    const otherUser = deriveTravelOrderIdempotency({
      ...base,
      owner: { ...base.owner, userId: 'user-2' },
    });
    const otherWorkspace = deriveTravelOrderIdempotency({
      ...base,
      owner: { ...base.owner, workspaceId: 'workspace-2' },
    });

    expect(new Set([first.key, otherUser.key, otherWorkspace.key]).size).toBe(3);
  });
});
