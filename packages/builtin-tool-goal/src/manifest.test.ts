import { describe, expect, it } from 'vitest';

import { GoalManifest } from './manifest';
import { GoalApiName } from './types';

describe('GoalManifest', () => {
  it('exposes only the canonical createGoal workflow', () => {
    expect(GoalManifest.identifier).toBe('lobe-goal');
    expect(GoalManifest.api.map(({ name }) => name)).toEqual([GoalApiName.createGoal]);
    // The goal tool runs under the group supervisor's headless/auto-run mode,
    // which converts 'always' into a blocked tool result instead of pausing for
    // the user — so the goal could never start. It is set to 'never' so the
    // supervisor can create and advance it automatically; the acceptance plan
    // remains editable on the goal page afterwards.
    expect(GoalManifest.api[0].humanIntervention).toBe('never');
    expect(GoalManifest.api[0].work).toBeUndefined();
  });
});
