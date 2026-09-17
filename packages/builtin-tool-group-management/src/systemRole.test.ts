import { describe, expect, it } from 'vitest';

import { supervisorSystemRole } from '../../builtin-agents/src/agents/group-supervisor/systemRole';
import { GoalManifest } from '../../builtin-tool-goal/src/manifest';
import { systemPrompt as goalPrompt } from '../../builtin-tool-goal/src/systemRole';
import { TaskManifest } from '../../builtin-tool-task/src/manifest';
import { systemPrompt as taskPrompt } from '../../builtin-tool-task/src/systemRole';
import { GroupManagementManifest } from './manifest';
import { systemPrompt } from './systemRole';

// These tool roles are composed together for a supervisor. A short-path rule
// in just one role must not be overridden by another role's creation mandate.
describe('simple delivery orchestration contract', () => {
  const combined = [supervisorSystemRole, systemPrompt, goalPrompt, taskPrompt].join('\n');

  it('keeps tool descriptions and supervisor defaults consistent with the simple path', () => {
    const descriptions = [...GoalManifest.api, ...TaskManifest.api]
      .map((api) => api.description)
      .join('\n');
    expect(descriptions).not.toContain('STRONGLY RECOMMENDED whenever');
    expect(descriptions).not.toContain(
      'in a group when the user explicitly requests a deliverable requiring coordinated dependent tasks',
    );
    expect(supervisorSystemRole).not.toContain('Default to Group Participation');
  });

  it('uses the existing finish callback for a final direct member delivery', () => {
    expect(systemPrompt).toContain('set skipCallSupervisor=true');
    const speak = GroupManagementManifest.api.find((api) => api.name === 'speak');
    expect(JSON.stringify(speak?.parameters)).toContain('final direct delivery');
    expect(JSON.stringify(speak?.parameters)).toContain(
      'Keep false while more coordination is required',
    );
  });

  it('preserves requested output limits through delegation and Skill use', () => {
    expect(systemPrompt).toContain(
      "Preserve the user's requested quantity, format, language and scope",
    );
    expect(systemPrompt).toContain('Skill defaults are guidance');
    expect(systemPrompt).toContain('do not add optional variants');
  });

  it('does not force every deliverable into persistent task execution', () => {
    expect(combined).not.toContain('FIRST call createTask');
    expect(combined).not.toContain('For a small independent deliverable, use a task instead');
    expect(combined).not.toContain('Is this an explicit final deliverable requested now?');
    expect(systemPrompt).toContain('a short text plus one image');
  });

  it('does not require a separate verifier for every delegated creative result', () => {
    expect(taskPrompt).not.toContain('Right after creating such a task, call setTaskVerify');
    expect(taskPrompt).toContain('Do not add a separate verify gate for routine creative work');
  });

  it('stops repeated capability troubleshooting instead of broadcasting the same blocker', () => {
    expect(systemPrompt).toContain('Do not broadcast the same capability failure');
    expect(systemPrompt).toContain('Never claim an unchecked result passed');
  });

  it('keeps explicit goals, requested independent review and existing task boundaries', () => {
    expect(goalPrompt).toContain('/goal');
    expect(systemPrompt).toContain('a different member than the author');
    expect(systemPrompt).toContain('Respect existing task/goal acceptance');
    expect(taskPrompt).toContain('Only the user retires a recurring task');
  });
});

it('limits dispatch skill selection to loadable skills without changing broadcast', () => {
  const speak = GroupManagementManifest.api.find((api) => api.name === 'speak')!;
  const broadcast = GroupManagementManifest.api.find((api) => api.name === 'broadcast')!;
  expect(speak.parameters.properties?.skillIdentifiers).toMatchObject({ type: 'array' });
  expect(JSON.stringify(speak.parameters.properties?.skillIdentifiers)).toContain('Project/device');
  expect(broadcast.parameters.properties?.skillIdentifiers).toBeUndefined();
  expect(systemPrompt).toContain('readFile/activate flow');
});
