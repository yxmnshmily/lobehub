// @vitest-environment node
import { agents, chatGroups, chatGroupsAgents, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkDefaultTravelServiceGroup,
  getDefaultTravelServiceGroupHealthSummary,
  initDefaultTravelServiceGroup,
} from './travelServiceGroup';

const db = await getTestDB();
const publisher = 'member-lifecycle-publisher';
const newcomer = 'member-lifecycle-newcomer';

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([publisher, newcomer].map((id) => ({ id, emailVerified: true })));
  const source = await initDefaultTravelServiceGroup(db, publisher);
  await db
    .update(chatGroups)
    .set({
      config: { ...source!.config, superGroupTemplate: { revision: 1, members: [] } },
    })
    .where(eq(chatGroups.id, source!.id));
});
afterEach(async () => {
  await db.delete(users);
});

describe('published default group member lifecycle', () => {
  it('does not recreate removed fallback members during repeated initialization', async () => {
    const group = await initDefaultTravelServiceGroup(db, newcomer);
    await initDefaultTravelServiceGroup(db, newcomer);
    const ownedAgents = await db.query.agents.findMany({ where: eq(agents.userId, newcomer) });
    expect(ownedAgents.filter(({ clientId }) => clientId?.startsWith('default-travel-'))).toEqual(
      [],
    );
    const roster = await db.query.chatGroupsAgents.findMany({
      where: eq(chatGroupsAgents.chatGroupId, group!.id),
    });
    expect(roster.map(({ role }) => role)).toEqual(['supervisor']);
  });

  it('accepts a published supervisor-only group as ready and healthy', async () => {
    const group = await initDefaultTravelServiceGroup(db, newcomer);
    await db
      .delete(chatGroupsAgents)
      .where(
        and(eq(chatGroupsAgents.chatGroupId, group!.id), eq(chatGroupsAgents.role, 'participant')),
      );
    expect((await checkDefaultTravelServiceGroup(db, newcomer)).ready).toBe(true);
    expect(
      (await getDefaultTravelServiceGroupHealthSummary(db, { targetUserId: newcomer })).issueCodes,
    ).toEqual([]);
  });

  it('detects a published member model drift without requiring the old builtin skills', async () => {
    const source = await db.query.chatGroups.findFirst({ where: eq(chatGroups.userId, publisher) });
    const member = {
      avatar: null,
      description: 'Existing Codex member',
      key: 'codex',
      model: 'codex-model',
      provider: 'existing-provider',
      params: { temperature: 0.2 },
      plugins: [],
      systemRole: 'Keep my configured instructions',
      title: 'Codex',
    };
    await db
      .update(chatGroups)
      .set({
        config: {
          ...source!.config,
          superGroupTemplate: { revision: 2, members: [member] },
        },
      })
      .where(eq(chatGroups.id, source!.id));
    await initDefaultTravelServiceGroup(db, newcomer);
    const candidate = await db.query.agents.findFirst({
      where: and(eq(agents.userId, newcomer), eq(agents.clientId, 'supergroup-template-codex')),
    });
    await db
      .update(agents)
      .set({ model: member.model, provider: member.provider, params: member.params })
      .where(eq(agents.id, candidate!.id));
    expect((await checkDefaultTravelServiceGroup(db, newcomer)).ready).toBe(true);
    await db.update(agents).set({ model: 'incorrect-model' }).where(eq(agents.id, candidate!.id));
    expect((await checkDefaultTravelServiceGroup(db, newcomer)).ready).toBe(false);
    expect(
      (await getDefaultTravelServiceGroupHealthSummary(db, { targetUserId: newcomer })).issueCodes,
    ).toEqual(['PUBLISHED_TEMPLATE_MEMBERS_OUT_OF_SYNC']);
  });

  it.each(['pinned', 'auto', 'disabled'] as const)(
    'compares real plugin object bindings including %s mode',
    async (mode) => {
      const source = await db.query.chatGroups.findFirst({
        where: eq(chatGroups.userId, publisher),
      });
      const member = {
        avatar: null,
        description: 'Configured tools',
        key: 'configured-member',
        plugins: ['lobe-agent-documents'],
        pluginBindings: [{ identifier: 'lobe-agent-documents', mode }],
        sourceAgentId: 'original-member',
        systemRole: 'Keep tools',
        title: 'Configured member',
      };
      await db
        .update(chatGroups)
        .set({
          config: { ...source!.config, superGroupTemplate: { revision: 2, members: [member] } },
        })
        .where(eq(chatGroups.id, source!.id));
      await initDefaultTravelServiceGroup(db, newcomer);
      const candidate = await db.query.agents.findFirst({
        where: and(
          eq(agents.userId, newcomer),
          eq(agents.clientId, 'supergroup-template-configured-member'),
        ),
      });
      expect(candidate?.plugins).toEqual([{ identifier: 'lobe-agent-documents', mode }]);
      expect((await checkDefaultTravelServiceGroup(db, newcomer)).ready).toBe(true);
      expect(
        (await getDefaultTravelServiceGroupHealthSummary(db, { targetUserId: newcomer }))
          .issueCodes,
      ).toEqual([]);
      await db
        .update(agents)
        .set({
          plugins: sql`${JSON.stringify([
            { identifier: 'lobe-agent-documents', mode: mode === 'pinned' ? 'disabled' : 'pinned' },
          ])}::jsonb`,
        })
        .where(eq(agents.id, candidate!.id));
      expect((await checkDefaultTravelServiceGroup(db, newcomer)).ready).toBe(false);
      expect(
        (await getDefaultTravelServiceGroupHealthSummary(db, { targetUserId: newcomer }))
          .issueCodes,
      ).toEqual(['PUBLISHED_TEMPLATE_MEMBERS_OUT_OF_SYNC']);
    },
  );
});
