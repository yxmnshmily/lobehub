import { describe, expect, it } from 'vitest';

import { GROUP_SUPERVISOR } from './index';

describe('GROUP_SUPERVISOR', () => {
  it('identifies as the tourism team coordinator without the upstream developer brand', () => {
    expect(GROUP_SUPERVISOR.runtime).toBeTypeOf('function');

    const result = (
      GROUP_SUPERVISOR.runtime as Extract<
        typeof GROUP_SUPERVISOR.runtime,
        (...args: never[]) => unknown
      >
    )({
      groupSupervisorContext: {
        availableAgents: [],
        groupId: 'travel-group',
        groupTitle: '川西旅游服务群',
      },
      model: 'travel-model',
    });

    expect(result.systemRole).toContain(
      'You are Travel Group Owner AI, an intelligent team coordinator for tourism services',
    );
    expect(result.systemRole).toContain('川西旅游服务群');
    expect(result.systemRole).not.toMatch(/LobeAI|LobeHub/);
  });
});
