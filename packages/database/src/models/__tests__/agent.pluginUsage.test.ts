// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import { AgentModel } from '../agent';

const db = await getTestDB();
const userId = 'plugin-usage-owner';
const otherId = 'plugin-usage-other';
const model = new AgentModel(db, userId);

beforeAll(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherId }]);
  await db.insert(agents).values([
    { id: 'usage-legacy', userId, plugins: ['docs'] },
    { id: 'usage-pinned', userId, plugins: [{ identifier: 'docs', mode: 'pinned' }] as any },
    { id: 'usage-auto', userId, plugins: [{ identifier: 'docs', mode: 'auto' }] as any },
    { id: 'usage-disabled', userId, plugins: [{ identifier: 'docs', mode: 'disabled' }] as any },
    { id: 'usage-unset', userId },
    { id: 'usage-other-tool', userId, plugins: ['different'] },
    { id: 'usage-other-owner', userId: otherId, plugins: ['docs'] },
  ]);
});
afterAll(async () => {
  await db.delete(users).where(inArray(users.id, [userId, otherId]));
});

describe('agent plugin usage', () => {
  it('filters before pagination and excludes disabled and foreign agents', async () => {
    const result = await model.queryAgents({ pluginId: 'docs', limit: 10 });
    expect(result.map((item) => item.id).sort()).toEqual([
      'usage-auto',
      'usage-legacy',
      'usage-pinned',
    ]);
    const first = await model.queryAgents({ pluginId: 'docs', limit: 2 });
    const next = await model.queryAgents({ pluginId: 'docs', limit: 2, offset: 2 });
    expect(new Set([...first, ...next].map((item) => item.id)).size).toBe(3);
    expect(next).toHaveLength(1);
  });
  it('keeps ordinary agent queries unchanged', async () => {
    expect(await model.queryAgents()).toHaveLength(6);
  });
  it('keeps the paginated query bounded with 1000 local agents', async () => {
    const benchmarkId = 'plugin-usage-benchmark';
    await db.insert(users).values({ id: benchmarkId });
    try {
      await db.insert(agents).values(
        Array.from({ length: 1000 }, (_, index) => ({
          id: `usage-benchmark-${index}`,
          userId: benchmarkId,
          plugins: index % 2 ? ['docs'] : [],
        })),
      );
      const benchmarkModel = new AgentModel(db, benchmarkId);
      const timings: number[] = [];
      for (let sample = 0; sample < 6; sample++) {
        const start = performance.now();
        const result = await benchmarkModel.queryAgents({
          pluginId: 'docs',
          limit: 13,
          offset: 12,
        });
        timings.push(performance.now() - start);
        expect(result).toHaveLength(13);
      }
      timings.sort((a, b) => a - b);
      console.info('Local skill usage query (PGlite, 1000 agents):', {
        medianMs: Number(((timings[2] + timings[3]) / 2).toFixed(2)),
        maxMs: Number(timings[5].toFixed(2)),
      });
    } finally {
      await db.delete(users).where(inArray(users.id, [benchmarkId]));
    }
  });

  it('treats plugin ids as exact parameterized values', async () => {
    expect(await model.queryAgents({ pluginId: "docs' OR 1=1 --" })).toEqual([]);
  });
});
