import { describe, expect, it } from 'vitest';

import type { LobeToolManifest } from '../../tools/types';
import { MessagesEngine } from '../MessagesEngine';

// Same topology as the observed first-turn trace: 10 executable tool families,
// seven additional catalog manifests, but no APIs from those seven in the call.
const enabled = [
  'remote-device',
  'activator',
  'skills',
  'skill-store',
  'web-browsing',
  'user-memory',
  'task',
  'agent',
  'group-management',
  'goal',
].map((id) => `lobe-${id}`);
const available = [
  'agent-documents',
  'image-generation',
  'knowledge-base',
  'browser',
  'topic-reference',
  'message',
  'local-system',
].map((id) => `lobe-${id}`);
const manifests = [...enabled, ...available].map((identifier) => ({
  api: [{ name: 'run', description: 'Run this tool' }],
  identifier,
  meta: { title: identifier },
  systemRole: `FULL_INSTRUCTIONS_${identifier}`,
  type: 'builtin',
})) as LobeToolManifest[];

const process = async (tools?: string[]) =>
  new MessagesEngine({
    enableSystemDate: false,
    messages: [
      { id: 'user', role: 'user', content: 'Write a caption', createdAt: 0, updatedAt: 0 } as any,
    ],
    model: 'test',
    provider: 'test',
    toolsConfig: { manifests, ...(tools === undefined ? {} : { tools }) },
    toolDiscoveryConfig: {
      availableTools: available.map((identifier) => ({
        identifier,
        name: identifier,
        description: 'Available on demand',
      })),
    },
  }).process();

const prompt = (result: Awaited<ReturnType<typeof process>>) =>
  result.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');

describe('tool prompt follows the executable tool set', () => {
  it('injects 10 executable manifests, not all 17 catalog manifests, while retaining discovery', async () => {
    const result = await process(enabled);
    const system = prompt(result);
    for (const id of enabled) expect(system).toContain(`FULL_INSTRUCTIONS_${id}`);
    for (const id of available) expect(system).not.toContain(`FULL_INSTRUCTIONS_${id}`);
    expect(JSON.stringify(result.messages)).toContain('Available on demand');
  });
  it('injects a newly activated tool on the next step', async () => {
    expect(prompt(await process([...enabled, available[0]]))).toContain(
      `FULL_INSTRUCTIONS_${available[0]}`,
    );
  });
  it('keeps compatibility when no executable tool list was supplied', async () => {
    const system = prompt(await process());
    for (const id of [...enabled, ...available])
      expect(system).toContain(`FULL_INSTRUCTIONS_${id}`);
  });
  it('omits full instructions when the explicit tool set is empty', async () => {
    expect(prompt(await process([]))).not.toContain('FULL_INSTRUCTIONS_');
  });
});
