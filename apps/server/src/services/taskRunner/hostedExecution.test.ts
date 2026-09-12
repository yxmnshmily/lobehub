import { describe, expect, it } from 'vitest';

import { grantPlatformManagedExecution } from '@/server/services/aiAgent/platformManagedExecution';

import { carryTaskExecutionContext, getTaskExecutionContext } from './hostedExecution';

describe('server-owned task budget envelope', () => {
  it('survives server middleware spreading without becoming serializable', () => {
    const sharedBudget = {} as any;
    const source = grantPlatformManagedExecution(
      { groupId: 'group-a' },
      {
        actorUserId: 'owner',
        resourceOwnerUserId: 'owner',
        sharedBudget,
      },
    );
    const caller = carryTaskExecutionContext({ userId: 'owner' }, source);
    expect(getTaskExecutionContext({ ...caller })).toMatchObject({ groupId: 'group-a' });
    expect(getTaskExecutionContext({ ...caller })?.capability.sharedBudget).toBe(sharedBudget);
    // Exercise the JSON transport boundary, not an in-process structured clone.
    // eslint-disable-next-line unicorn/prefer-structured-clone
    expect(getTaskExecutionContext(JSON.parse(JSON.stringify(caller)))).toBeUndefined();
  });

  it('does not accept a JSON budget or inherit a personal conversation implicitly', () => {
    const forged = { groupId: 'group-a', sharedBudget: {}, actorUserId: 'owner' };
    expect(getTaskExecutionContext(carryTaskExecutionContext({}, forged))).toBeUndefined();
    expect(
      getTaskExecutionContext(
        carryTaskExecutionContext(
          {},
          grantPlatformManagedExecution({}, { sharedBudget: {} as any }),
        ),
      ),
    ).toBeUndefined();
  });
});
