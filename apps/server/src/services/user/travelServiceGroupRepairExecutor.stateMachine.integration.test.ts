// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  agentSkills,
  chatGroups,
  chatGroupsAgents,
  users,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildDefaultTravelServiceGroupRepairPlan,
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  type DefaultTravelServiceGroupHealthIssueCode,
  executeDefaultTravelServiceGroupRepairPlan,
  getDefaultTravelServiceGroupHealthSummary,
  initDefaultTravelServiceGroup,
  type SafeDefaultTravelServiceGroupRepairActionCode,
  TRAVEL_SPECIALIST_TEMPLATES,
} from './travelServiceGroup';

const userId = 'travel-repair-state-machine-user';
const db: LobeChatDatabase = await getTestDB();
const requiredClientIds = TRAVEL_SPECIALIST_TEMPLATES.map(({ clientId }) => clientId);

const health = (workspaceId?: string) =>
  getDefaultTravelServiceGroupHealthSummary(db, { targetUserId: userId, workspaceId });
const preview = async (workspaceId?: string) =>
  buildDefaultTravelServiceGroupRepairPlan(await health(workspaceId));

const getGroup = async () => {
  const group = await db.query.chatGroups.findFirst({
    where: and(
      eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
      eq(chatGroups.userId, userId),
    ),
  });
  if (!group) throw new Error('Expected group fixture');
  return group;
};

const getRoster = (groupId: string) =>
  db
    .select({
      agencyConfig: agents.agencyConfig,
      agentId: agents.id,
      agentUserId: agents.userId,
      agentWorkspaceId: agents.workspaceId,
      clientId: agents.clientId,
      enabled: chatGroupsAgents.enabled,
      relationUserId: chatGroupsAgents.userId,
      relationWorkspaceId: chatGroupsAgents.workspaceId,
      role: chatGroupsAgents.role,
    })
    .from(chatGroupsAgents)
    .innerJoin(agents, eq(agents.id, chatGroupsAgents.agentId))
    .where(eq(chatGroupsAgents.chatGroupId, groupId));

const initialize = async () => {
  await initDefaultTravelServiceGroup(db, userId);
  return getGroup();
};

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({
    email: 'state-machine@example.test',
    emailVerified: true,
    id: userId,
    normalizedEmail: 'state-machine@example.test',
  });
});

afterEach(async () => {
  await db.execute(sql`DROP TRIGGER IF EXISTS change_user_on_private ON chat_groups`);
  await db.execute(sql`DROP FUNCTION IF EXISTS change_user_on_private()`);
  await db.delete(users);
});

const actionCases: Array<{
  actionCode: SafeDefaultTravelServiceGroupRepairActionCode;
  issueCode: DefaultTravelServiceGroupHealthIssueCode;
  prepare: () => Promise<void>;
}> = [
  {
    actionCode: 'CREATE_DEFAULT_GROUP',
    issueCode: 'DEFAULT_GROUP_MISSING',
    prepare: async () => undefined,
  },
  {
    actionCode: 'SET_PRIVATE',
    issueCode: 'DEFAULT_GROUP_NOT_PRIVATE',
    prepare: async () => {
      const group = await initialize();
      await db.update(chatGroups).set({ visibility: 'public' }).where(eq(chatGroups.id, group.id));
    },
  },
  {
    actionCode: 'ENSURE_GROUP_INSTRUCTIONS',
    issueCode: 'DEFAULT_GROUP_INSTRUCTIONS_MISSING',
    prepare: async () => {
      const group = await initialize();
      await db.update(chatGroups).set({ content: '   ' }).where(eq(chatGroups.id, group.id));
    },
  },
  {
    actionCode: 'ENSURE_SUPERVISOR',
    issueCode: 'SUPERVISOR_COUNT_INVALID',
    prepare: async () => {
      const group = await initialize();
      await db
        .delete(chatGroupsAgents)
        .where(
          and(eq(chatGroupsAgents.chatGroupId, group.id), eq(chatGroupsAgents.role, 'supervisor')),
        );
    },
  },
  {
    actionCode: 'MIGRATE_LEGACY_INBOX_SUPERVISOR',
    issueCode: 'LEGACY_INBOX_SUPERVISOR',
    prepare: async () => {
      const group = await initialize();
      const roster = await getRoster(group.id);
      const supervisor = roster.find(({ role }) => role === 'supervisor');
      const inbox = await db.query.agents.findFirst({
        where: and(eq(agents.userId, userId), eq(agents.slug, 'inbox')),
      });
      if (!supervisor || !inbox) throw new Error('Expected legacy Inbox fixtures');
      await db
        .delete(chatGroupsAgents)
        .where(
          and(
            eq(chatGroupsAgents.chatGroupId, group.id),
            eq(chatGroupsAgents.agentId, supervisor.agentId),
          ),
        );
      await db.insert(chatGroupsAgents).values({
        agentId: inbox.id,
        chatGroupId: group.id,
        enabled: true,
        order: 0,
        role: 'supervisor',
        userId,
      });
    },
  },
  {
    actionCode: 'RENAME_SUPERVISOR',
    issueCode: 'SUPERVISOR_TITLE_INVALID',
    prepare: async () => {
      const group = await initialize();
      const supervisor = (await getRoster(group.id)).find(({ role }) => role === 'supervisor');
      if (!supervisor) throw new Error('Expected supervisor fixture');
      await db
        .update(agents)
        .set({ title: 'wrong title' })
        .where(eq(agents.id, supervisor.agentId));
    },
  },
  {
    actionCode: 'MARK_PLATFORM_MANAGED',
    issueCode: 'SUPERVISOR_NOT_PLATFORM_MANAGED',
    prepare: async () => {
      const group = await initialize();
      const supervisor = (await getRoster(group.id)).find(({ role }) => role === 'supervisor');
      if (!supervisor) throw new Error('Expected supervisor fixture');
      await db
        .update(agents)
        .set({ agencyConfig: { modelRuntimeMode: 'actor', modelSelectionPolicy: 'fixed' } })
        .where(eq(agents.id, supervisor.agentId));
    },
  },
  {
    actionCode: 'ENSURE_REQUIRED_MEMBER',
    issueCode: 'DESIGNER_MISSING',
    prepare: async () => {
      const group = await initialize();
      const member = (await getRoster(group.id)).find(
        ({ clientId }) => clientId === 'default-travel-image-designer',
      );
      if (!member) throw new Error('Expected member fixture');
      await db
        .delete(chatGroupsAgents)
        .where(
          and(
            eq(chatGroupsAgents.chatGroupId, group.id),
            eq(chatGroupsAgents.agentId, member.agentId),
          ),
        );
    },
  },
  {
    actionCode: 'ENABLE_REQUIRED_MEMBER',
    issueCode: 'COPYWRITER_DISABLED',
    prepare: async () => {
      const group = await initialize();
      const member = (await getRoster(group.id)).find(
        ({ clientId }) => clientId === 'default-travel-copywriter',
      );
      if (!member) throw new Error('Expected member fixture');
      await db
        .update(chatGroupsAgents)
        .set({ enabled: false })
        .where(
          and(
            eq(chatGroupsAgents.chatGroupId, group.id),
            eq(chatGroupsAgents.agentId, member.agentId),
          ),
        );
    },
  },
];

describe('travel service group repair executor state machine', () => {
  it.each(actionCases)(
    '$actionCode moves its declared precondition to one healthy five-member group',
    async ({ actionCode, issueCode, prepare }) => {
      await prepare();
      const before = await health();
      expect(before.issueCodes).toContain(issueCode);
      const expectedPlan = buildDefaultTravelServiceGroupRepairPlan(before);
      expect(expectedPlan.actions).toEqual([
        expect.objectContaining({ code: actionCode, reviewRequired: false }),
      ]);

      const result = await executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan,
        targetUserId: userId,
      });

      expect(result.actionCounts).toEqual([{ code: actionCode, count: 1 }]);
      expect(result.finalHealth).toMatchObject({ groupCount: 1, healthy: true, issueCodes: [] });
      const group = await getGroup();
      const roster = await getRoster(group.id);
      expect(group.visibility).toBe('private');
      expect(roster).toHaveLength(5);
      expect(new Set(roster.map(({ agentId }) => agentId))).toHaveProperty('size', 5);
      expect(roster.filter(({ role }) => role === 'supervisor')).toHaveLength(1);
      expect(
        roster.every(
          ({ agentUserId, agentWorkspaceId, relationUserId, relationWorkspaceId }) =>
            agentUserId === userId &&
            relationUserId === userId &&
            agentWorkspaceId === null &&
            relationWorkspaceId === null,
        ),
      ).toBe(true);
    },
  );

  it('repairs an owned workspace group without crossing the workspace boundary', async () => {
    const group = await initialize();
    await db.insert(workspaces).values({
      id: 'state-machine-workspace',
      name: 'State machine workspace',
      primaryOwnerId: userId,
      slug: 'state-machine-workspace',
    });
    const roster = await getRoster(group.id);
    await db
      .update(agents)
      .set({ workspaceId: 'state-machine-workspace' })
      .where(
        inArray(
          agents.id,
          roster.map(({ agentId }) => agentId),
        ),
      );
    await db
      .update(agentSkills)
      .set({ workspaceId: 'state-machine-workspace' })
      .where(eq(agentSkills.userId, userId));
    await db
      .update(chatGroupsAgents)
      .set({ workspaceId: 'state-machine-workspace' })
      .where(eq(chatGroupsAgents.chatGroupId, group.id));
    await db
      .update(chatGroups)
      .set({ visibility: 'public', workspaceId: 'state-machine-workspace' })
      .where(eq(chatGroups.id, group.id));

    const result = await executeDefaultTravelServiceGroupRepairPlan(db, {
      expectedPlan: await preview('state-machine-workspace'),
      targetUserId: userId,
      workspaceId: 'state-machine-workspace',
    });

    expect(result.actionCounts).toEqual([{ code: 'SET_PRIVATE', count: 1 }]);
    expect(result.finalHealth).toMatchObject({ healthy: true, isPrivate: true });
    expect(
      (await getRoster(group.id)).every(
        ({ agentWorkspaceId, relationWorkspaceId }) =>
          agentWorkspaceId === 'state-machine-workspace' &&
          relationWorkspaceId === 'state-machine-workspace',
      ),
    ).toBe(true);
  });

  it('allows only one of two concurrent identical plans to commit after health changes', async () => {
    const group = await initialize();
    await db.update(chatGroups).set({ visibility: 'public' }).where(eq(chatGroups.id, group.id));
    const expectedPlan = await preview();

    const results = await Promise.allSettled([
      executeDefaultTravelServiceGroupRepairPlan(db, { expectedPlan, targetUserId: userId }),
      executeDefaultTravelServiceGroupRepairPlan(db, { expectedPlan, targetUserId: userId }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected' });
    if (rejected?.status === 'rejected') {
      expect((rejected.reason as Error).message).toMatch(
        /^(TRAVEL_GROUP_REPAIR_STATE_CHANGED|TRAVEL_GROUP_REPAIR_EXECUTION_FAILED)$/,
      );
    }
    await expect(health()).resolves.toMatchObject({ healthy: true, isPrivate: true });
    await expect(getRoster(group.id)).resolves.toHaveLength(5);
  });

  it.each(['ban', 'delete'] as const)(
    'fails closed and rolls back when a trigger changes the target to %s during execution',
    async (mode) => {
      const group = await initialize();
      const copywriter = (await getRoster(group.id)).find(
        ({ clientId }) => clientId === 'default-travel-copywriter',
      );
      if (!copywriter) throw new Error('Expected copywriter fixture');
      await db.update(chatGroups).set({ visibility: 'public' }).where(eq(chatGroups.id, group.id));
      await db
        .update(chatGroupsAgents)
        .set({ enabled: false })
        .where(
          and(
            eq(chatGroupsAgents.chatGroupId, group.id),
            eq(chatGroupsAgents.agentId, copywriter.agentId),
          ),
        );
      await db.execute(
        sql.raw(`
        CREATE FUNCTION change_user_on_private() RETURNS trigger AS $$
        BEGIN
          ${
            mode === 'ban'
              ? 'UPDATE users SET banned = TRUE WHERE id = NEW.user_id;'
              : 'DELETE FROM users WHERE id = NEW.user_id;'
          }
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `),
      );
      await db.execute(sql`
        CREATE TRIGGER change_user_on_private
        AFTER UPDATE OF visibility ON chat_groups
        FOR EACH ROW
        WHEN (OLD.visibility = 'public' AND NEW.visibility = 'private')
        EXECUTE FUNCTION change_user_on_private()
      `);

      const execution = executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan: await preview(),
        targetUserId: userId,
      });

      await expect(execution).rejects.toThrow('TRAVEL_GROUP_REPAIR_SCOPE_INVALID');
      await expect(getGroup()).resolves.toMatchObject({ visibility: 'public' });
      await expect(
        db.query.users.findFirst({ where: eq(users.id, userId) }),
      ).resolves.toMatchObject({
        banned: false,
      });
      await expect(
        db.query.chatGroupsAgents.findFirst({
          where: and(
            eq(chatGroupsAgents.chatGroupId, group.id),
            eq(chatGroupsAgents.agentId, copywriter.agentId),
          ),
        }),
      ).resolves.toMatchObject({ enabled: false });
    },
  );
});

type DatabaseOperation = 'insert' | 'select' | 'update';

const instrumentTransaction = (
  database: LobeChatDatabase,
  options: { failAt?: number; failCommit?: boolean } = {},
) => {
  const operations: DatabaseOperation[] = [];
  let operationIndex = 0;
  let operationFaulted = false;
  const wrapped = new Proxy(database, {
    get(target, property, receiver) {
      if (property !== 'transaction') {
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (callback: (transaction: LobeChatDatabase) => Promise<unknown>) =>
        database.transaction(async (transaction) => {
          const instrumentedTransaction = new Proxy(transaction as LobeChatDatabase, {
            get(transactionTarget, transactionProperty, transactionReceiver) {
              const value = Reflect.get(
                transactionTarget,
                transactionProperty,
                transactionReceiver,
              );
              if (
                transactionProperty !== 'insert' &&
                transactionProperty !== 'select' &&
                transactionProperty !== 'update'
              ) {
                return typeof value === 'function' ? value.bind(transactionTarget) : value;
              }
              return (...args: unknown[]) => {
                operationIndex += 1;
                operations.push(transactionProperty);
                if (operationIndex === options.failAt) {
                  operationFaulted = true;
                  throw new Error('injected SQL failure with private-id and provider config');
                }
                return (value as (...input: unknown[]) => unknown).apply(transactionTarget, args);
              };
            },
          });
          const result = await callback(instrumentedTransaction);
          if (operationFaulted) throw new Error('injected transaction-aborted state');
          if (options.failCommit) throw new Error('injected commit failure with private-id');
          return result;
        });
    },
  }) as LobeChatDatabase;
  return { database: wrapped, operations };
};

describe('travel service group repair executor fault injection', () => {
  it('rolls back every observed insert, update, or select failure without leaking its cause', async () => {
    const recorder = instrumentTransaction(db);
    await executeDefaultTravelServiceGroupRepairPlan(recorder.database, {
      expectedPlan: await preview(),
      targetUserId: userId,
    });
    expect(new Set(recorder.operations)).toEqual(new Set(['insert', 'select', 'update']));

    for (let failAt = 1; failAt <= recorder.operations.length; failAt += 1) {
      const faultUserId = `travel-repair-fault-user-${failAt}`;
      await db.insert(users).values({
        email: `repair-fault-${failAt}@example.test`,
        emailVerified: true,
        id: faultUserId,
        normalizedEmail: `repair-fault-${failAt}@example.test`,
      });
      const missingPlan = buildDefaultTravelServiceGroupRepairPlan(
        await getDefaultTravelServiceGroupHealthSummary(db, { targetUserId: faultUserId }),
      );
      const injected = instrumentTransaction(db, { failAt });
      const execution = executeDefaultTravelServiceGroupRepairPlan(injected.database, {
        expectedPlan: missingPlan,
        targetUserId: faultUserId,
      });
      const error = await execution.then(
        () => null,
        (reason: Error) => reason,
      );
      if (!error) {
        throw new Error(
          `fault ${failAt}/${recorder.operations.length} (${recorder.operations[failAt - 1]}) did not abort`,
        );
      }
      expect(error.message).toBe('TRAVEL_GROUP_REPAIR_EXECUTION_FAILED');
      expect(error.message).not.toContain('private-id');
      expect(error.message).not.toContain('provider');
      await expect(
        getDefaultTravelServiceGroupHealthSummary(db, { targetUserId: faultUserId }),
      ).resolves.toMatchObject({
        groupCount: 0,
        issueCodes: ['DEFAULT_GROUP_MISSING'],
      });
      await expect(
        db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.userId, faultUserId), inArray(agents.clientId, requiredClientIds))),
      ).resolves.toHaveLength(0);
      await db.delete(users).where(eq(users.id, faultUserId));
    }
  });

  it('rolls back the complete plan when the transaction cannot commit', async () => {
    const injected = instrumentTransaction(db, { failCommit: true });

    const execution = executeDefaultTravelServiceGroupRepairPlan(injected.database, {
      expectedPlan: await preview(),
      targetUserId: userId,
    });

    await expect(execution).rejects.toThrow('TRAVEL_GROUP_REPAIR_EXECUTION_FAILED');
    await expect(health()).resolves.toMatchObject({
      groupCount: 0,
      issueCodes: ['DEFAULT_GROUP_MISSING'],
    });
  });
});
