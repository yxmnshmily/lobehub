// @vitest-environment node
import {
  agents,
  agentSkills,
  chatGroups,
  chatGroupsAgents,
  roles,
  userRoles,
  users,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentSkillsRouter } from '../../routers/lambda/agentSkills';
import { AgentService } from '../agent';
import {
  buildDefaultTravelServiceGroupRepairPlan,
  checkDefaultTravelServiceGroup,
  executeDefaultTravelServiceGroupRepairPlan,
  getDefaultTravelServiceGroupHealthSummary,
  initDefaultTravelServiceGroup,
} from './travelServiceGroup';
import {
  getSuperGroupTemplate,
  importSuperGroupTemplateMember,
  removeSuperGroupTemplateMember,
  reorderSuperGroupTemplateMembers,
  savePublishedSuperGroupAgent,
  upsertSuperGroupTemplateMember,
} from './travelServiceGroupTemplate';

const db = await getTestDB();
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => db }));
// Text-skill saves do not touch object storage; avoid eager S3 setup in the router context.
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
const adminId = 'super-template-admin';
const customerId = 'super-template-customer';
const futureId = 'super-template-future';
const memberInput = {
  avatar: '🏔️',
  description: '熟悉西藏行程规划',
  key: 'tibet-planner',
  plugins: ['lobe-travel-production' as const],
  systemRole: '根据真实交通和景点信息规划西藏行程。',
  title: '西藏策划助理',
};

beforeEach(async () => {
  await db.delete(users);
  await db
    .insert(users)
    .values([adminId, customerId, futureId].map((id) => ({ id, emailVerified: true })));
  await db
    .insert(roles)
    .values({ name: 'super_admin', displayName: 'Super Admin', isActive: true })
    .onConflictDoNothing();
  const role = await db.query.roles.findFirst({ where: eq(roles.name, 'super_admin') });
  await db.insert(userRoles).values({ roleId: role!.id, userId: adminId });
  await initDefaultTravelServiceGroup(db, adminId);
  await initDefaultTravelServiceGroup(db, customerId);
});

afterEach(async () => {
  await db.delete(users);
});

const findMember = (userId: string, key = memberInput.key) =>
  db.query.agents.findFirst({
    where: and(eq(agents.userId, userId), eq(agents.clientId, `supergroup-template-${key}`)),
  });

describe('administrator super-group template', () => {
  it.each([null, undefined])(
    'ignores a %s config patch without publishing or changing the member',
    async (value) => {
      await upsertSuperGroupTemplateMember(db, adminId, memberInput);
      const member = await findMember(adminId);
      const template = await getSuperGroupTemplate(db);
      await expect(savePublishedSuperGroupAgent(db, adminId, member!.id, value)).resolves.toBe(
        false,
      );
      expect(await getSuperGroupTemplate(db)).toEqual(template);
      expect(await findMember(adminId)).toEqual(member);
    },
  );

  it.each(['#336699', 'http://localhost:3010/lobehub/files/generated-background.webp'])(
    'publishes background %s and resets across source, group copies and future users',
    async (backgroundColor) => {
      const [source] = await db
        .insert(agents)
        .values({
          userId: adminId,
          name: 'Writer',
          title: '编剧',
          model: 'gpt-4o',
          provider: 'openai',
        })
        .returning();
      const { member } = await importSuperGroupTemplateMember(db, adminId, { agentId: source.id });
      await new AgentService(db, adminId).updateAgentConfig(source.id, { backgroundColor });
      expect(
        (await getSuperGroupTemplate(db)).members.find((item) => item.key === member.key),
      ).toMatchObject({ backgroundColor });
      await initDefaultTravelServiceGroup(db, futureId);
      for (const userId of [adminId, customerId, futureId]) {
        expect(await findMember(userId, member.key)).toMatchObject({ backgroundColor });
      }
      const customerCopy = await findMember(customerId, member.key);
      await db
        .update(agents)
        .set({ backgroundColor: '#ffffff' })
        .where(eq(agents.id, customerCopy!.id));
      expect(
        (await getDefaultTravelServiceGroupHealthSummary(db, { targetUserId: customerId }))
          .issueCodes,
      ).toContain('PUBLISHED_TEMPLATE_MEMBERS_OUT_OF_SYNC');
      await initDefaultTravelServiceGroup(db, customerId);
      expect(await findMember(customerId, member.key)).toMatchObject({ backgroundColor });
      const copy = await findMember(adminId, member.key);
      await new AgentService(db, adminId).updateAgentConfig(copy!.id, { backgroundColor: null });
      expect(await db.query.agents.findFirst({ where: eq(agents.id, source.id) })).toMatchObject({
        backgroundColor: null,
      });
      for (const userId of [adminId, customerId, futureId]) {
        expect(await findMember(userId, member.key)).toMatchObject({ backgroundColor: null });
      }
    },
  );

  it.each(['source', 'copy'])(
    'saves presentation from the %s without republishing pending resource skills',
    async (entry) => {
      const identifier = 'asuralg-my-ai-agent-skills-travel-guide-maker';
      await db.insert(agentSkills).values({
        userId: adminId,
        identifier,
        name: '旅行攻略',
        description: '旅行攻略资源',
        source: 'user',
        content: '攻略正文',
        resources: { 'guide.md': { fileHash: 'private-resource', size: 10 } },
      });
      const [source] = await db
        .insert(agents)
        .values({
          userId: adminId,
          name: 'Guide',
          title: '向导',
          model: 'gpt-4o',
          provider: 'openai',
          plugins: [identifier],
        })
        .returning();
      const { member } = await importSuperGroupTemplateMember(db, adminId, {
        agentId: source.id,
        allowPending: true,
      });
      expect(member.pendingReason).toContain(identifier);
      const copy = await findMember(adminId, member.key);
      const presentation = {
        avatar: 'https://example.com/avatar.png',
        backgroundColor: 'https://example.com/cover.png',
        name: '新向导',
        title: '旅行向导',
        description: '更新档案',
      };
      await new AgentService(db, adminId).updateAgentConfig(
        entry === 'source' ? source.id : copy!.id,
        presentation,
      );
      expect(
        (await getSuperGroupTemplate(db)).members.find((item) => item.key === member.key),
      ).toEqual({ ...member, ...presentation });
      expect(await db.query.agents.findFirst({ where: eq(agents.id, source.id) })).toMatchObject({
        ...presentation,
        plugins: [identifier],
      });
      await initDefaultTravelServiceGroup(db, futureId);
      for (const userId of [adminId, customerId, futureId]) {
        expect(await findMember(userId, member.key)).toMatchObject({
          ...presentation,
          description: `【加入】\n${presentation.description}`,
          plugins: [identifier],
          agencyConfig: { publicationBlockedReason: member.pendingReason },
        });
      }
    },
  );

  it('saves supervisor artwork without publishing newly installed private tools', async () => {
    const supervisor = await db.query.agents.findFirst({
      where: and(eq(agents.userId, adminId), eq(agents.slug, 'group-supervisor')),
    });
    const service = new AgentService(db, adminId);
    await service.updateAgentConfig(supervisor!.id, { model: 'gpt-4o', provider: 'openai' });
    const published = (await getSuperGroupTemplate(db)).supervisor!;
    const plugins = [...(supervisor!.plugins ?? []), 'private-connector'];
    await db.update(agents).set({ plugins }).where(eq(agents.id, supervisor!.id));
    await service.updateAgentConfig(supervisor!.id, {
      backgroundColor: 'https://example.com/cover.png',
    });
    expect((await getSuperGroupTemplate(db)).supervisor).toEqual({
      ...published,
      backgroundColor: 'https://example.com/cover.png',
    });
    expect(await db.query.agents.findFirst({ where: eq(agents.id, supervisor!.id) })).toMatchObject(
      { plugins },
    );
    await initDefaultTravelServiceGroup(db, futureId);
    for (const userId of [customerId, futureId]) {
      expect(
        await db.query.agents.findFirst({
          where: and(eq(agents.userId, userId), eq(agents.slug, 'group-supervisor')),
        }),
      ).toMatchObject({
        backgroundColor: 'https://example.com/cover.png',
        plugins: published.pluginBindings ?? published.plugins,
      });
    }
  });

  it('preserves local backgroundColor when a legacy template omits it', async () => {
    await upsertSuperGroupTemplateMember(db, adminId, memberInput);
    const copy = await findMember(customerId);
    await db.update(agents).set({ backgroundColor: '#112233' }).where(eq(agents.id, copy!.id));
    await initDefaultTravelServiceGroup(db, customerId);
    expect(await findMember(customerId)).toMatchObject({ backgroundColor: '#112233' });
  });

  it('rejects settings outside the portable template instead of silently saving only one copy', async () => {
    const [source] = await db
      .insert(agents)
      .values({
        userId: adminId,
        name: 'Writer',
        title: '编剧',
        model: 'gpt-4o',
        provider: 'openai',
      })
      .returning();
    await importSuperGroupTemplateMember(db, adminId, { agentId: source.id });
    await expect(
      new AgentService(db, adminId).updateAgentConfig(source.id, {
        chatConfig: { runtimeEnv: { workingDirectory: '/private/admin/files' } },
      }),
    ).rejects.toThrow(/不支持同步/);
    expect(await db.query.agents.findFirst({ where: eq(agents.id, source.id) })).toMatchObject({
      chatConfig: null,
    });
  });
  it('automatically republishes edited text skills for every bound template member', async () => {
    const [skill] = await db
      .insert(agentSkills)
      .values({
        userId: adminId,
        identifier: 'script-guide',
        name: '脚本技能',
        description: '脚本格式',
        content: '旧内容',
        source: 'user',
      })
      .returning();
    const keys: string[] = [];
    for (const name of ['Writer', 'Reviewer']) {
      const [source] = await db
        .insert(agents)
        .values({
          userId: adminId,
          name,
          title: '编剧',
          model: 'gpt-4o',
          provider: 'openai',
          plugins: ['script-guide'],
        })
        .returning();
      const { member } = await importSuperGroupTemplateMember(db, adminId, { agentId: source.id });
      keys.push(member.key);
    }
    const caller = agentSkillsRouter.createCaller({
      userId: adminId,
      jwtPayload: { userId: adminId },
    } as any);
    await caller.update({
      id: skill.id,
      content: '新版脚本规范',
      manifest: { description: '新版说明' },
    });
    for (const key of keys) {
      const copy = await db.query.agentSkills.findFirst({
        where: and(
          eq(agentSkills.userId, customerId),
          eq(agentSkills.identifier, `supergroup-${key}-script-guide`),
        ),
      });
      expect(copy).toMatchObject({ content: '新版脚本规范', description: '新版说明' });
    }
    await initDefaultTravelServiceGroup(db, futureId);
    expect(
      await db.query.agentSkills.findFirst({ where: eq(agentSkills.userId, futureId) }),
    ).toMatchObject({ content: '新版脚本规范' });
  });

  it('rejects an ordinary user changing a published group copy', async () => {
    const [source] = await db
      .insert(agents)
      .values({
        userId: adminId,
        name: 'Writer',
        title: '原职业',
        model: 'gpt-4o',
        provider: 'openai',
      })
      .returning();
    const { member } = await importSuperGroupTemplateMember(db, adminId, { agentId: source.id });
    const copy = await findMember(customerId, member.key);
    await expect(
      new AgentService(db, customerId).updateAgentConfig(copy!.id, { title: '越权修改' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await findMember(adminId, member.key)).toMatchObject({ title: '原职业' });
  });

  it('automatically publishes saved source config to existing and future groups', async () => {
    const [source] = await db
      .insert(agents)
      .values({
        userId: adminId,
        name: 'Writer',
        title: '旧职业',
        model: 'gpt-4o',
        provider: 'openai',
      })
      .returning();
    const { member } = await importSuperGroupTemplateMember(db, adminId, { agentId: source.id });
    await new AgentService(db, adminId).updateAgentConfig(source.id, {
      title: '编剧',
      model: 'gpt-4.1',
      systemRole: '写短视频脚本',
      params: { temperature: 0.4 },
    });
    for (const userId of [adminId, customerId]) {
      expect(await findMember(userId, member.key)).toMatchObject({
        name: 'Writer',
        title: '编剧',
        model: 'gpt-4.1',
        systemRole: '写短视频脚本',
        params: { temperature: 0.4 },
      });
    }
    await initDefaultTravelServiceGroup(db, futureId);
    expect(await findMember(futureId, member.key)).toMatchObject({ title: '编剧' });
    await new AgentService(db, adminId).updateAgentConfig(source.id, { name: '' });
    expect(await findMember(customerId, member.key)).toMatchObject({ name: null, title: '编剧' });
  });

  it('automatically synchronizes supervisor settings without adding a second supervisor', async () => {
    const supervisor = await db.query.agents.findFirst({
      where: and(eq(agents.userId, adminId), eq(agents.slug, 'group-supervisor')),
    });
    expect(supervisor).toBeDefined();
    await new AgentService(db, adminId).updateAgentConfig(supervisor!.id, {
      model: 'gpt-4.1',
      provider: 'openai',
      systemRole: '统一协调所有群成员',
      backgroundColor: '#445566',
    });
    await initDefaultTravelServiceGroup(db, futureId);
    for (const userId of [adminId, customerId, futureId]) {
      expect(
        await db.query.agents.findFirst({
          where: and(eq(agents.userId, userId), eq(agents.slug, 'group-supervisor')),
        }),
      ).toMatchObject({
        model: 'gpt-4.1',
        systemRole: '统一协调所有群成员',
        backgroundColor: '#445566',
      });
      const supervisors = await db.query.chatGroupsAgents.findMany({
        where: and(eq(chatGroupsAgents.userId, userId), eq(chatGroupsAgents.role, 'supervisor')),
      });
      expect(supervisors).toHaveLength(1);
    }
  });

  it('saves an administrator group copy through its original template member', async () => {
    const [source] = await db
      .insert(agents)
      .values({
        userId: adminId,
        name: 'Writer',
        title: '旧职业',
        model: 'gpt-4o',
        provider: 'openai',
      })
      .returning();
    const { member } = await importSuperGroupTemplateMember(db, adminId, { agentId: source.id });
    const copy = await findMember(adminId, member.key);
    await new AgentService(db, adminId).updateAgentConfig(copy!.id, { title: '编剧' });
    expect(await db.query.agents.findFirst({ where: eq(agents.id, source.id) })).toMatchObject({
      title: '编剧',
    });
    expect(await findMember(customerId, member.key)).toMatchObject({ title: '编剧' });
  });

  it('rolls back source edits and every group when a saved binding cannot be shared', async () => {
    const [source] = await db
      .insert(agents)
      .values({
        userId: adminId,
        name: 'Writer',
        title: '旧职业',
        model: 'gpt-4o',
        provider: 'openai',
      })
      .returning();
    const { member } = await importSuperGroupTemplateMember(db, adminId, { agentId: source.id });
    const revision = (await getSuperGroupTemplate(db)).revision;
    await expect(
      new AgentService(db, adminId).updateAgentConfig(source.id, {
        title: '不应保存',
        plugins: ['private-connector'],
      }),
    ).rejects.toThrow(/连接器或资源技能/);
    expect((await getSuperGroupTemplate(db)).revision).toBe(revision);
    expect(await db.query.agents.findFirst({ where: eq(agents.id, source.id) })).toMatchObject({
      title: '旧职业',
    });
    expect(await findMember(customerId, member.key)).toMatchObject({ title: '旧职业' });
  });

  it('preserves separate member names and occupations through publication and repeated synchronization', async () => {
    const [original] = await db
      .insert(agents)
      .values({
        userId: adminId,
        name: 'Codex',
        title: '编程助手',
        model: 'gpt-5-codex',
        provider: 'openai',
        systemRole: '完成编码任务',
      })
      .returning();
    const published = await importSuperGroupTemplateMember(db, adminId, { agentId: original.id });
    expect(published.member).toMatchObject({ name: 'Codex', title: '编程助手' });
    // Existing groups receive identity changes at publication, without waiting for re-entry.
    await db.update(agents).set({ title: '软件工程师' }).where(eq(agents.id, original.id));
    const updated = await importSuperGroupTemplateMember(db, adminId, { agentId: original.id });
    expect(updated.syncedGroupCount).toBe(2);
    expect(updated.member.key).toBe(published.member.key);
    for (const userId of [adminId, customerId]) {
      expect(await findMember(userId, published.member.key)).toMatchObject({
        name: 'Codex',
        title: '软件工程师',
      });
    }
    for (const userId of [adminId, customerId, futureId]) {
      await initDefaultTravelServiceGroup(db, userId);
      await initDefaultTravelServiceGroup(db, userId);
      expect(await findMember(userId, published.member.key)).toMatchObject({
        name: 'Codex',
        title: '软件工程师',
      });
      const group = await db.query.chatGroups.findFirst({ where: eq(chatGroups.userId, userId) });
      expect(
        group!.config!.memberSlots!.find((slot) => slot.key === published.member.key)?.label,
      ).toBe('Codex');
    }
  });

  it('keeps one shared template when a second administrator publishes updates', async () => {
    await upsertSuperGroupTemplateMember(db, adminId, memberInput);
    const role = await db.query.roles.findFirst({ where: eq(roles.name, 'super_admin') });
    await db.insert(userRoles).values({ roleId: role!.id, userId: futureId });
    const result = await upsertSuperGroupTemplateMember(db, futureId, {
      ...memberInput,
      title: '统一更新后的策划助理',
      systemRole: '所有用户使用同一个管理员模板。',
    });
    await initDefaultTravelServiceGroup(db, futureId);
    const groups = await db.query.chatGroups.findMany();
    const sources = groups.filter((group) => group.config?.superGroupTemplate);
    expect(sources).toHaveLength(1);
    expect(sources[0].userId).toBe(adminId);
    expect(result.revision).toBe(2);
    for (const userId of [adminId, customerId, futureId]) {
      expect(await findMember(userId)).toMatchObject({
        title: '统一更新后的策划助理',
        systemRole: '所有用户使用同一个管理员模板。',
      });
    }
  });

  it('adds a non-portable original as a pending member without distributing device bindings', async () => {
    const [original] = await db
      .insert(agents)
      .values({
        userId: adminId,
        title: 'Codex',
        model: 'gpt-5.5',
        provider: 'chatgpt',
        systemRole: '原始编码指令',
        agencyConfig: { boundDeviceId: 'private-device' },
      })
      .returning();
    const result = await importSuperGroupTemplateMember(db, adminId, {
      agentId: original.id,
      allowPending: true,
    });
    expect(result.member.pendingReason).toContain('本机');
    const copy = await findMember(customerId, result.member.key);
    expect(copy?.title).toBe('Codex');
    expect(copy?.agencyConfig?.boundDeviceId).toBeUndefined();
    expect(copy?.agencyConfig?.publicationBlockedReason).toContain('本机');
    expect(copy?.systemRole).toBe('原始编码指令');
    await removeSuperGroupTemplateMember(db, adminId, { key: result.member.key });
    await initDefaultTravelServiceGroup(db, futureId);
    expect(
      (await getSuperGroupTemplate(db)).members.some((m) => m.sourceAgentId === original.id),
    ).toBe(false);
    expect(await findMember(futureId, result.member.key)).toBeUndefined();
  });
  it('synchronizes member order to existing and future default groups and rejects stale rosters', async () => {
    const before = await getSuperGroupTemplate(db);
    const keys = before.members.map((member) => member.key).reverse();
    await expect(reorderSuperGroupTemplateMembers(db, customerId, { keys })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      reorderSuperGroupTemplateMembers(db, adminId, { keys: keys.slice(1) }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await reorderSuperGroupTemplateMembers(db, adminId, { keys });
    await initDefaultTravelServiceGroup(db, futureId);
    for (const userId of [adminId, customerId, futureId]) {
      const group = await db.query.chatGroups.findFirst({ where: eq(chatGroups.userId, userId) });
      const slots = group!.config!.memberSlots!.filter((slot) => keys.includes(slot.key));
      expect(slots.map((slot) => slot.key)).toEqual(keys);
      const memberships = await db
        .select()
        .from(chatGroupsAgents)
        .where(eq(chatGroupsAgents.chatGroupId, group!.id));
      expect(
        slots.map((slot) => memberships.find((item) => item.agentId === slot.agentId)!.order),
      ).toEqual([1, 2, 3, 4]);
    }
  });
  it('publishes an owned configured member without credentials and removes only membership', async () => {
    const [original] = await db
      .insert(agents)
      .values({
        userId: adminId,
        title: 'Codex',
        model: 'gpt-5-codex',
        provider: 'openai',
        systemRole: '完成编码任务',
        plugins: ['lobe-agent-documents', 'lobe-message'],
        params: { temperature: 0.4 },
        metadata: { apiKey: 'private-secret' },
      })
      .returning();
    const published = await importSuperGroupTemplateMember(db, adminId, { agentId: original.id });
    expect(published.member).toMatchObject({
      sourceAgentId: original.id,
      model: 'gpt-5-codex',
      provider: 'openai',
    });
    const copy = await findMember(customerId, published.member.key);
    expect(copy).toMatchObject({
      model: 'gpt-5-codex',
      provider: 'openai',
      params: { temperature: 0.4 },
      plugins: ['lobe-agent-documents', 'lobe-message'],
    });
    expect(copy!.metadata).toBeNull();
    const again = await importSuperGroupTemplateMember(db, adminId, { agentId: original.id });
    expect(again.member.key).toBe(published.member.key);
    await removeSuperGroupTemplateMember(db, adminId, { key: published.member.key });
    expect(await db.query.agents.findFirst({ where: eq(agents.id, original.id) })).toBeDefined();
    expect(await db.query.agents.findFirst({ where: eq(agents.id, copy!.id) })).toBeDefined();
    expect(
      await db.query.chatGroupsAgents.findFirst({ where: eq(chatGroupsAgents.agentId, copy!.id) }),
    ).toBeUndefined();
    expect(
      (await getSuperGroupTemplate(db)).members.some((m) => m.key === published.member.key),
    ).toBe(false);
  });

  it('rejects non-admin publication and importing another users private member', async () => {
    const [original] = await db
      .insert(agents)
      .values({
        userId: customerId,
        title: 'Private',
        model: 'deepseek-v4-pro',
        provider: 'deepseek',
      })
      .returning();
    await expect(
      importSuperGroupTemplateMember(db, customerId, { agentId: original.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      importSuperGroupTemplateMember(db, adminId, { agentId: original.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      removeSuperGroupTemplateMember(db, customerId, { key: 'copywriter' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('publishes bound text skills without overwriting private skills and rejects device members', async () => {
    await db.insert(agentSkills).values({
      userId: adminId,
      identifier: 'copy-skill',
      name: '文案技能',
      description: '写文案',
      source: 'user',
      content: '可公开技能正文',
      manifest: { name: '文案技能', description: '写文案' },
    });
    await db.insert(agentSkills).values({
      userId: customerId,
      identifier: 'copy-skill',
      name: '私人技能',
      description: '私人',
      source: 'user',
      content: '不要覆盖',
      manifest: { name: '私人技能', description: '私人' },
    });
    const [original] = await db
      .insert(agents)
      .values({
        userId: adminId,
        title: '文案成员',
        model: 'deepseek-v4-pro',
        provider: 'deepseek',
        plugins: ['copy-skill'],
      })
      .returning();
    const result = await importSuperGroupTemplateMember(db, adminId, { agentId: original.id });
    const copied = await findMember(customerId, result.member.key);
    expect(copied!.plugins).not.toContain('copy-skill');
    expect(
      await db.query.agentSkills.findFirst({
        where: and(
          eq(agentSkills.userId, customerId),
          eq(agentSkills.identifier, copied!.plugins![0]),
        ),
      }),
    ).toMatchObject({ content: '可公开技能正文' });
    expect(
      await db.query.agentSkills.findFirst({
        where: and(eq(agentSkills.userId, customerId), eq(agentSkills.identifier, 'copy-skill')),
      }),
    ).toMatchObject({ content: '不要覆盖' });
    await db
      .update(agents)
      .set({ agencyConfig: { boundDeviceId: 'private-device' } })
      .where(eq(agents.id, original.id));
    await expect(
      importSuperGroupTemplateMember(db, adminId, { agentId: original.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('preserves real object tool bindings and their activation modes', async () => {
    const bindings = [
      { identifier: 'lobe-task', mode: 'pinned' },
      { identifier: 'lobe-message', mode: 'disabled' },
    ];
    const [original] = await db
      .insert(agents)
      .values({
        userId: adminId,
        title: 'DeepSeek成员',
        model: 'deepseek-v4-pro',
        provider: 'deepseek',
        plugins: bindings as never,
      })
      .returning();
    const result = await importSuperGroupTemplateMember(db, adminId, { agentId: original.id });
    expect((await findMember(customerId, result.member.key))!.plugins).toEqual(bindings);
  });
  it('synchronizes 100 assistant slots with one fixed supervisor and atomically rejects slot 101', async () => {
    const existingGroups = await db.query.chatGroups.findMany();
    const supervisors = await db.query.chatGroupsAgents.findMany({
      where: eq(chatGroupsAgents.role, 'supervisor'),
    });
    const source = existingGroups.find((group) => group.userId === adminId)!;
    const base = await getSuperGroupTemplate(db);
    // Seed only the isolated test template to exercise the supported capacity in one publication.
    const capacityTemplate = {
      revision: 1,
      members: [
        ...base.members,
        ...Array.from({ length: 99 - base.members.length }, (_, index) => ({
          ...memberInput,
          key: `capacity-fixture-${index}`,
          title: `Capacity fixture ${index}`,
        })),
      ],
    };
    await db
      .update(chatGroups)
      .set({
        config: { ...source.config, superGroupTemplate: capacityTemplate },
      })
      .where(eq(chatGroups.id, source.id));

    const saved = await upsertSuperGroupTemplateMember(db, adminId, memberInput);
    expect(saved.syncedGroupCount).toBe(2);
    expect((await getSuperGroupTemplate(db)).members).toHaveLength(100);
    for (const group of existingGroups) {
      const roster = await db.query.chatGroupsAgents.findMany({
        where: eq(chatGroupsAgents.chatGroupId, group.id),
      });
      expect(roster.filter(({ role }) => role === 'participant')).toHaveLength(100);
      expect(
        roster.filter(({ role }) => role === 'supervisor').map(({ agentId }) => agentId),
      ).toEqual(
        supervisors
          .filter(({ chatGroupId }) => chatGroupId === group.id)
          .map(({ agentId }) => agentId),
      );
    }
    const publishedTemplate = await getSuperGroupTemplate(db);
    const publishedRoster = await db.query.chatGroupsAgents.findMany({
      orderBy: [chatGroupsAgents.chatGroupId, chatGroupsAgents.agentId],
    });
    await expect(
      upsertSuperGroupTemplateMember(db, adminId, {
        ...memberInput,
        key: 'capacity-overflow',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    for (const userId of [adminId, customerId]) {
      expect(await findMember(userId, 'capacity-overflow')).toBeUndefined();
    }
    expect(await getSuperGroupTemplate(db)).toEqual(publishedTemplate);
    expect(
      await db.query.chatGroupsAgents.findMany({
        orderBy: [chatGroupsAgents.chatGroupId, chatGroupsAgents.agentId],
      }),
    ).toEqual(publishedRoster);
    expect((await db.query.chatGroups.findMany()).map(({ id }) => id).sort()).toEqual(
      existingGroups.map(({ id }) => id).sort(),
    );
  }, 30_000);

  it('restores the same tourism coordinator and upgrades only the old default instructions', async () => {
    const group = await db.query.chatGroups.findFirst({ where: eq(chatGroups.userId, customerId) });
    const coordinator = await db.query.chatGroupsAgents.findFirst({
      where: and(
        eq(chatGroupsAgents.chatGroupId, group!.id),
        eq(chatGroupsAgents.role, 'supervisor'),
      ),
    });
    const legacyInstructions = `你在这个群组中的用户可见身份是“旅游群主AI”，负责统筹旅游服务内容与制作任务。

- 根据用户需求，将文案、图片封面、视频、行程文档交给群内对应的制作助理，然后向用户汇总最终结果。
- 不向用户暴露内部 Agent ID、平台密钥、调度标记或系统实现细节。
- 未实际生成的图片、视频或文档不得宣称已完成；信息不足时先请用户补充。
- 默认使用用户的语言回复，旅游地名、行程、价格和时刻等不得虚构。`;
    await db
      .update(chatGroups)
      .set({ content: legacyInstructions })
      .where(eq(chatGroups.id, group!.id));
    await db.update(agents).set({ description: null }).where(eq(agents.id, coordinator!.agentId));
    expect(await checkDefaultTravelServiceGroup(db, customerId)).toMatchObject({ ready: false });
    const health = await getDefaultTravelServiceGroupHealthSummary(db, {
      targetUserId: customerId,
    });
    expect(health.issueCodes).toContain('DEFAULT_GROUP_INSTRUCTIONS_MISSING');
    await executeDefaultTravelServiceGroupRepairPlan(db, {
      targetUserId: customerId,
      expectedPlan: buildDefaultTravelServiceGroupRepairPlan(health),
    });
    expect(await checkDefaultTravelServiceGroup(db, customerId)).toMatchObject({ ready: true });
    expect(
      await db.query.agents.findFirst({ where: eq(agents.id, coordinator!.agentId) }),
    ).toMatchObject({
      description: expect.stringContaining('协调分歧'),
    });
    await db.update(agents).set({ description: null }).where(eq(agents.id, coordinator!.agentId));
    await db
      .delete(chatGroupsAgents)
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, group!.id),
          eq(chatGroupsAgents.agentId, coordinator!.agentId),
        ),
      );
    await initDefaultTravelServiceGroup(db, customerId);
    await initDefaultTravelServiceGroup(db, customerId);
    const repaired = await db.query.chatGroups.findFirst({ where: eq(chatGroups.id, group!.id) });
    expect(repaired!.content).toContain('讨论秩序');
    expect(repaired!.content).toContain('不能擅自添加或删除助理');
    expect(
      await db.query.chatGroupsAgents.findMany({
        where: and(
          eq(chatGroupsAgents.chatGroupId, group!.id),
          eq(chatGroupsAgents.role, 'supervisor'),
        ),
      }),
    ).toMatchObject([{ agentId: coordinator!.agentId, enabled: true }]);
    expect(
      await db.query.agents.findFirst({ where: eq(agents.id, coordinator!.agentId) }),
    ).toMatchObject({
      title: '旅游群主AI',
      description: expect.stringContaining('协调分歧'),
    });
    await db
      .update(chatGroups)
      .set({ content: '管理员自定义的协作规则' })
      .where(eq(chatGroups.id, group!.id));
    await initDefaultTravelServiceGroup(db, customerId);
    expect(
      await db.query.chatGroups.findFirst({ where: eq(chatGroups.id, group!.id) }),
    ).toMatchObject({
      content: '管理员自定义的协作规则',
    });
  });

  it('backfills missing built-in introductions before any administrator template has been saved', async () => {
    const condition = and(
      eq(agents.userId, customerId),
      eq(agents.clientId, 'default-travel-copywriter'),
    );
    await db.update(agents).set({ description: null }).where(condition);
    await initDefaultTravelServiceGroup(db, customerId);
    expect(await db.query.agents.findFirst({ where: condition })).toMatchObject({
      description: '按照旅游业务目标产出可发布、可口播的文案。',
      agencyConfig: { modelRuntimeMode: 'platform-managed' },
    });
    expect((await getSuperGroupTemplate(db)).revision).toBe(0);
  });

  it('adds isolated assistants to existing groups and future users without duplicating on retry', async () => {
    const result = await upsertSuperGroupTemplateMember(db, adminId, memberInput);
    expect(result.syncedGroupCount).toBe(2);
    const adminMember = await findMember(adminId);
    const customerMember = await findMember(customerId);
    expect(customerMember).toMatchObject({
      title: '西藏策划助理',
      description: '熟悉西藏行程规划',
      userId: customerId,
      agencyConfig: { modelRuntimeMode: 'platform-managed' },
    });
    expect(adminMember!.id).not.toBe(customerMember!.id);
    const futureGroup = await initDefaultTravelServiceGroup(db, futureId);
    expect(futureGroup?.config?.memberSlots?.some(({ key }) => key === 'tibet-planner')).toBe(true);
    expect(await findMember(futureId)).toMatchObject({ title: '西藏策划助理', userId: futureId });
    await upsertSuperGroupTemplateMember(db, adminId, { ...memberInput, title: '西藏目的地策划' });
    await initDefaultTravelServiceGroup(db, customerId);
    expect(await findMember(customerId)).toMatchObject({
      id: customerMember!.id,
      title: '西藏目的地策划',
    });
    expect(
      (await getSuperGroupTemplate(db)).members.filter(({ key }) => key === memberInput.key),
    ).toHaveLength(1);
  });

  it('reports and safely repairs a published custom assistant missing from one customer group', async () => {
    await upsertSuperGroupTemplateMember(db, adminId, memberInput);
    const group = await db.query.chatGroups.findFirst({ where: eq(chatGroups.userId, customerId) });
    const member = await findMember(customerId);
    await db
      .delete(chatGroupsAgents)
      .where(
        and(eq(chatGroupsAgents.chatGroupId, group!.id), eq(chatGroupsAgents.agentId, member!.id)),
      );

    const health = await getDefaultTravelServiceGroupHealthSummary(db, {
      targetUserId: customerId,
    });
    expect(health).toMatchObject({ healthy: false });
    expect(health.issueCodes).toContain('PUBLISHED_TEMPLATE_MEMBERS_OUT_OF_SYNC');
    const plan = buildDefaultTravelServiceGroupRepairPlan(health);
    expect(plan).toMatchObject({
      actions: [expect.objectContaining({ code: 'APPLY_PUBLISHED_TEMPLATE', target: 'group' })],
      reviewRequired: false,
    });

    const repaired = await executeDefaultTravelServiceGroupRepairPlan(db, {
      expectedPlan: plan,
      targetUserId: customerId,
    });
    expect(repaired.finalHealth).toMatchObject({ healthy: true, issueCodes: [] });
    expect(await checkDefaultTravelServiceGroup(db, customerId)).toMatchObject({ ready: true });
    expect(
      await db.query.chatGroupsAgents.findMany({
        where: and(
          eq(chatGroupsAgents.chatGroupId, group!.id),
          eq(chatGroupsAgents.agentId, member!.id),
        ),
      }),
    ).toMatchObject([{ enabled: true, role: 'participant' }]);
  });

  it('requires manual review for an unknown managed assistant and preserves it', async () => {
    const group = await db.query.chatGroups.findFirst({ where: eq(chatGroups.userId, customerId) });
    const [unknown] = await db
      .insert(agents)
      .values({
        clientId: 'supergroup-template-unknown-assistant',
        title: '待核实助理',
        userId: customerId,
      })
      .returning();
    await db.insert(chatGroupsAgents).values({
      agentId: unknown.id,
      chatGroupId: group!.id,
      userId: customerId,
    });

    const health = await getDefaultTravelServiceGroupHealthSummary(db, {
      targetUserId: customerId,
    });
    expect(health.issueCodes).toContain('PUBLISHED_TEMPLATE_MEMBERS_REVIEW_REQUIRED');
    const plan = buildDefaultTravelServiceGroupRepairPlan(health);
    expect(plan).toMatchObject({
      actions: [expect.objectContaining({ reviewRequired: true, target: 'group' })],
      reviewRequired: true,
    });
    await expect(
      executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan: plan,
        targetUserId: customerId,
      }),
    ).rejects.toThrow('TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED');
    expect(await db.query.agents.findFirst({ where: eq(agents.id, unknown.id) })).toBeDefined();
    expect(
      await db.query.chatGroupsAgents.findFirst({
        where: and(
          eq(chatGroupsAgents.chatGroupId, group!.id),
          eq(chatGroupsAgents.agentId, unknown.id),
        ),
      }),
    ).toBeDefined();
  });

  it('rejects ordinary users and unsafe tool bindings before changing the template', async () => {
    await expect(upsertSuperGroupTemplateMember(db, customerId, memberInput)).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
    await expect(
      upsertSuperGroupTemplateMember(db, adminId, {
        ...memberInput,
        plugins: ['private-api-key-tool'] as never,
      }),
    ).rejects.toThrow();
    expect((await getSuperGroupTemplate(db)).revision).toBe(0);
    expect(await findMember(customerId)).toBeUndefined();
  });

  it('keeps group identity and configuration while changing the built-in assistant profile', async () => {
    const group = await db.query.chatGroups.findFirst({ where: eq(chatGroups.userId, customerId) });
    await db
      .update(chatGroups)
      .set({
        config: { ...group!.config, openingMessage: '保留我的开场白' },
        content: '保留我的群说明',
      })
      .where(eq(chatGroups.id, group!.id));
    const result = await upsertSuperGroupTemplateMember(db, adminId, {
      ...memberInput,
      key: 'copywriter',
      title: '旅游口播文案助理',
    });
    await initDefaultTravelServiceGroup(db, customerId);
    const existing = await db.query.chatGroups.findFirst({ where: eq(chatGroups.id, group!.id) });
    expect(existing).toMatchObject({
      content: '保留我的群说明',
      config: { openingMessage: '保留我的开场白' },
    });
    expect(
      await db.query.agents.findFirst({
        where: and(eq(agents.userId, customerId), eq(agents.clientId, 'default-travel-copywriter')),
      }),
    ).toMatchObject({ title: '旅游口播文案助理' });
    const memberships = await db.query.chatGroupsAgents.findMany({
      where: eq(chatGroupsAgents.chatGroupId, group!.id),
    });
    expect(memberships).toHaveLength(5);
    expect(result.revision).toBe(1);
    expect(
      await getDefaultTravelServiceGroupHealthSummary(db, { targetUserId: customerId }),
    ).toMatchObject({ healthy: true });
    expect(await checkDefaultTravelServiceGroup(db, customerId)).toMatchObject({ ready: true });
  });

  it('rolls back every group and the published template when one target has a conflicting workspace identity', async () => {
    await db.insert(workspaces).values({
      id: 'super-template-workspace',
      slug: 'super-template-workspace',
      name: 'Workspace',
      primaryOwnerId: customerId,
    });
    await db.insert(agents).values({
      clientId: 'supergroup-template-tibet-planner',
      userId: customerId,
      workspaceId: 'super-template-workspace',
    });
    await expect(upsertSuperGroupTemplateMember(db, adminId, memberInput)).rejects.toThrow();
    expect((await getSuperGroupTemplate(db)).revision).toBe(0);
    expect(await findMember(adminId)).toBeUndefined();
    await db.delete(workspaces).where(eq(workspaces.id, 'super-template-workspace'));
  });

  it('rejects a member key that would replace the supervisor display slot', async () => {
    await expect(
      upsertSuperGroupTemplateMember(db, adminId, { ...memberInput, key: 'travel-owner' }),
    ).rejects.toThrow();
    expect((await getSuperGroupTemplate(db)).revision).toBe(0);
  });
});
