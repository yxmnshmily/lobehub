import { describe, expect, it } from 'vitest';

import {
  getPlatformManagedExecutionContext,
  grantPlatformManagedExecution,
  hasPlatformManagedExecutionCapability,
} from './platformManagedExecution';

describe('platformManagedExecution capability', () => {
  it('carries a non-enumerable trusted limit only in process', () => {
    const holder = grantPlatformManagedExecution({ prompt: '制作行程' }, { maxCredits: 1234 });

    expect(getPlatformManagedExecutionContext(holder)).toEqual({ maxCredits: 1234 });
    expect(hasPlatformManagedExecutionCapability(holder)).toBe(true);
    expect(JSON.stringify(holder)).toBe('{"prompt":"制作行程"}');
    expect(
      getPlatformManagedExecutionContext({
        maxCredits: 1234,
        platformManagedExecutionAuthorized: true,
      }),
    ).toBeUndefined();
    expect(getPlatformManagedExecutionContext({ ...holder })).toBeUndefined();
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid trusted limit %s',
    (maxCredits) => {
      expect(() => grantPlatformManagedExecution({}, { maxCredits })).toThrow(TypeError);
    },
  );

  it('requires actor and resource-owner identities as one trusted pair', () => {
    expect(() => grantPlatformManagedExecution({}, { actorUserId: 'member-user' } as any)).toThrow(
      TypeError,
    );
    expect(() =>
      grantPlatformManagedExecution({}, { resourceOwnerUserId: 'owner-user' } as any),
    ).toThrow(TypeError);
    expect(() =>
      grantPlatformManagedExecution({}, {
        actorUserId: ' ',
        resourceOwnerUserId: 'owner-user',
      } as any),
    ).toThrow(TypeError);
  });
});
