import { randomUUID } from 'node:crypto';

import { GROUP_SUPERVISOR } from '@lobechat/builtin-agents';
import { TravelProductionIdentifier } from '@lobechat/builtin-tool-travel-production';
import { builtinTools } from '@lobechat/builtin-tools';
import type { LobeChatDatabase } from '@lobechat/database';
import { agents, agentSkills, chatGroups, globalFiles } from '@lobechat/database/schemas';
import { type AgentPluginEntry, AgentPluginEntrySchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { ChatGroupModel } from '@/database/models/chatGroup';
import type {
  ChatGroupConfig,
  SuperGroupTemplate,
  SuperGroupTemplateMember,
} from '@/database/types/chatGroup';
import { hasActivePlatformAdminAccess } from '@/server/routers/lambda/_helpers/platformAdminGuard';

import {
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  initDefaultTravelServiceGroup,
  TRAVEL_SPECIALIST_TEMPLATES,
} from './travelServiceGroup';

export const superGroupTemplateMemberInput = z
  .object({
    avatar: z.string().max(2048).nullable().optional(),
    backgroundColor: z.string().nullable().optional(),
    description: z.string().trim().max(1000),
    name: z.string().trim().min(1).max(255).optional(),
    key: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
      .refine((key) => key !== 'travel-owner', 'The supervisor slot is reserved')
      .optional(),
    plugins: z
      .array(z.enum([TravelProductionIdentifier, 'lobe-agent-documents']))
      .max(2)
      .optional(),
    systemRole: z.string().trim().min(1).max(20_000),
    title: z.string().trim().min(1).max(100),
  })
  .strict();

export const getSuperGroupTemplateMemberClientId = (key: string) =>
  TRAVEL_SPECIALIST_TEMPLATES.find((item) => item.key === key)?.clientId ??
  `supergroup-template-${key}`;

const fallbackTemplate = (): SuperGroupTemplate => ({
  members: TRAVEL_SPECIALIST_TEMPLATES.map((item) => ({
    avatar: null,
    description: item.description,
    key: item.key,
    plugins: [...item.plugins],
    systemRole: item.systemRole,
    title: item.label,
  })),
  revision: 0,
});

const getTemplateSource = async (db: LobeChatDatabase) => {
  const sources = await db
    .select()
    .from(chatGroups)
    .where(
      and(
        eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
        isNull(chatGroups.workspaceId),
        sql`${chatGroups.config}->'superGroupTemplate' IS NOT NULL`,
      ),
    )
    .limit(2);
  if (sources.length > 1)
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Multiple super-group template sources require administrator review',
    });
  return sources[0];
};

export const getSuperGroupTemplate = async (db: LobeChatDatabase): Promise<SuperGroupTemplate> =>
  (await getTemplateSource(db))?.config?.superGroupTemplate ?? fallbackTemplate();

/** Serializes publication and onboarding so a new user cannot miss an in-flight template update. */
export const lockSuperGroupTemplate = (db: LobeChatDatabase) =>
  db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('travel-super-group-template'))`);

export const applySuperGroupTemplate = async (
  db: LobeChatDatabase,
  groupId: string,
  userId: string,
  template?: SuperGroupTemplate,
  removedKeys: string[] = [],
) => {
  const current = template ?? (await getSuperGroupTemplate(db));
  if (current.revision === 0) return;
  const groupModel = new ChatGroupModel(db, userId);
  const group = await groupModel.findById(groupId);
  if (!group || group.clientId !== DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID || group.workspaceId)
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Super-group scope changed during synchronization',
    });
  const agentModel = new AgentModel(db, userId);
  const slots: NonNullable<ChatGroupConfig['memberSlots']> = [];
  for (const member of [...current.members, ...(current.supervisor ? [current.supervisor] : [])]) {
    const isSupervisor = member === current.supervisor;
    for (const skill of member.skills ?? []) {
      const published = await new AgentSkillModel(db, userId).ensureByIdentifier({
        ...skill,
        manifest: { name: skill.name, description: skill.description },
      });
      // Product-skill ensure deliberately preserves resources. Published template
      // copies instead follow the exact approved snapshot (including removals).
      await db
        .update(agentSkills)
        .set({
          resources: skill.resources ?? {},
          zipFileHash: skill.zipFileHash ?? null,
        })
        .where(
          and(
            eq(agentSkills.id, published.id),
            eq(agentSkills.userId, userId),
            isNull(agentSkills.workspaceId),
          ),
        );
    }
    const agent = isSupervisor
      ? await agentModel.getBuiltinAgent(GROUP_SUPERVISOR.slug)
      : await agentModel.ensureByClientId(getSuperGroupTemplateMemberClientId(member.key), {
          agencyConfig: { modelRuntimeMode: 'platform-managed', modelSelectionPolicy: 'fixed' },
          systemRole: member.systemRole,
          title: member.title,
          virtual: true,
        });
    if (!agent) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template member not found' });
    const builtin = TRAVEL_SPECIALIST_TEMPLATES.find((item) => item.key === member.key);
    // Copy only the published presentation/instructions/tools; never credentials, files or user data.
    await db
      .update(agents)
      .set({
        title: member.title,
        systemRole: member.systemRole,
        agencyConfig: {
          modelRuntimeMode: 'platform-managed',
          modelSelectionPolicy: 'fixed',
          ...(member.pendingReason ? { publicationBlockedReason: member.pendingReason } : {}),
        },
        ...(member.sourceAgentId || (member.model && member.provider)
          ? {
              model: member.model ?? null,
              provider: member.provider ?? null,
              params: member.params ?? {},
            }
          : {}),
        avatar: member.avatar,
        ...(member.backgroundColor !== undefined
          ? { backgroundColor: member.backgroundColor }
          : {}),
        ...(member.name !== undefined ? { name: member.name || null } : {}),
        description: member.pendingReason ? `【加入】\n${member.description}` : member.description,
        ...(isSupervisor && agent.id === member.sourceAgentId
          ? {}
          : {
              plugins: member.sourceAgentId
                ? ((member.pluginBindings ?? member.plugins) as string[])
                : [...new Set([...member.plugins, ...(builtin?.skillSlots ?? [])])],
            }),
        updatedAt: new Date(),
      })
      .where(and(eq(agents.id, agent.id), eq(agents.userId, userId), isNull(agents.workspaceId)));
    if ((!member.model || !member.provider) && !member.pendingReason)
      await agentModel.ensurePlatformManagedModelRuntime(agent.id);
    if (!isSupervisor)
      slots.push({
        agentId: agent.id,
        configurable: false,
        key: member.key,
        label: member.name || member.title,
        role: 'participant',
        skillSlots: builtin ? [...builtin.skillSlots] : [],
        status: 'configured',
      });
  }
  await groupModel.ensureParticipantAgents(
    groupId,
    slots.map((slot) => slot.agentId!),
  );
  const keys = new Set(slots.map((slot) => slot.key));
  for (const slot of group.config?.memberSlots ?? []) {
    if (slot.role === 'participant' && removedKeys.includes(slot.key) && slot.agentId)
      await groupModel.removeAgentFromGroup(groupId, slot.agentId);
  }
  // Replace the roster exactly. Historical agents and messages remain intact.
  await db
    .update(chatGroups)
    .set({
      config: {
        ...group.config,
        memberSlots: [
          ...(group.config?.memberSlots ?? []).filter(
            (slot) => !keys.has(slot.key) && !removedKeys.includes(slot.key),
          ),
          ...slots,
        ],
      },
      updatedAt: new Date(),
    })
    .where(and(eq(chatGroups.id, groupId), eq(chatGroups.userId, userId)));
  return groupModel.findById(groupId);
};

/** Administrator save is atomic with existing-group synchronization; failed groups roll back publication. */
const publishTemplate = async (
  db: LobeChatDatabase,
  operatorUserId: string,
  mutate: (
    previous: SuperGroupTemplate,
    tx: LobeChatDatabase,
  ) => Promise<SuperGroupTemplateMember[]>,
  supervisor?: SuperGroupTemplateMember,
) => {
  return db.transaction(async (transaction) => {
    const tx = transaction as LobeChatDatabase;
    await lockSuperGroupTemplate(tx);
    if (!(await hasActivePlatformAdminAccess(tx, operatorUserId)))
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Platform administrator access is required',
      });
    let source = await getTemplateSource(tx);
    if (!source) {
      const group = await initDefaultTravelServiceGroup(tx, operatorUserId);
      if (!group)
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'An active administrator default group is required',
        });
      source = group;
    }
    const previous = source.config?.superGroupTemplate ?? fallbackTemplate();
    const members = await mutate(previous, tx);
    if (members.length > 100)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'A super-group can have at most 100 members',
      });
    const next: SuperGroupTemplate = {
      ...previous,
      members,
      revision: previous.revision + 1,
      ...(supervisor ? { supervisor } : {}),
    };
    await tx
      .update(chatGroups)
      .set({ config: { ...source.config, superGroupTemplate: next }, updatedAt: new Date() })
      .where(eq(chatGroups.id, source.id));
    const groups = await tx
      .select({ id: chatGroups.id, userId: chatGroups.userId })
      .from(chatGroups)
      .where(
        and(
          eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
          isNull(chatGroups.workspaceId),
        ),
      );
    const removedKeys = previous.members
      .filter((old) => !members.some((member) => member.key === old.key))
      .map((member) => member.key);
    for (const group of groups)
      await applySuperGroupTemplate(tx, group.id, group.userId, next, removedKeys);
    return { revision: next.revision, syncedGroupCount: groups.length };
  });
};

export const upsertSuperGroupTemplateMember = async (
  db: LobeChatDatabase,
  operatorUserId: string,
  input: z.input<typeof superGroupTemplateMemberInput>,
) => {
  const parsed = superGroupTemplateMemberInput.parse(input);
  let member!: SuperGroupTemplateMember;
  const result = await publishTemplate(db, operatorUserId, async (previous) => {
    const builtin = TRAVEL_SPECIALIST_TEMPLATES.find((item) => item.key === parsed.key);
    const existing = previous.members.find((item) => item.key === parsed.key);
    member = {
      ...existing,
      ...parsed,
      avatar: parsed.avatar ?? null,
      key: parsed.key ?? randomUUID(),
      plugins: [
        ...new Set([
          ...(parsed.plugins ?? existing?.plugins ?? [TravelProductionIdentifier]),
          ...(builtin?.plugins ?? []),
        ]),
      ],
    };
    const existingIndex = previous.members.findIndex((item) => item.key === member.key);
    const members = [...previous.members];
    if (existingIndex < 0) members.push(member);
    else members[existingIndex] = member;
    return members;
  });
  return { ...result, member };
};

export const removeSuperGroupTemplateMemberInput = z
  .object({ key: z.string().min(1).max(80) })
  .strict();
export const reorderSuperGroupTemplateMembersInput = z
  .object({
    keys: z.array(z.string().min(1).max(80)).max(100),
  })
  .strict();

export const reorderSuperGroupTemplateMembers = async (
  db: LobeChatDatabase,
  operatorUserId: string,
  input: z.input<typeof reorderSuperGroupTemplateMembersInput>,
) => {
  const { keys } = reorderSuperGroupTemplateMembersInput.parse(input);
  return publishTemplate(db, operatorUserId, async (previous) => {
    if (
      keys.length !== previous.members.length ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !previous.members.some((member) => member.key === key))
    )
      throw new TRPCError({ code: 'CONFLICT', message: '成员列表已变化，请刷新后重新排序。' });
    return keys.map((key) => previous.members.find((member) => member.key === key)!);
  });
};
export const importSuperGroupTemplateMemberInput = z
  .object({
    agentId: z.string().min(1).max(100),
    allowPending: z.boolean().optional(),
    /** Explicitly approve sharing these bound skills' archives/resources with all default groups. */
    publishResourceSkills: z.array(z.string().min(1).max(255)).max(100).optional(),
    key: superGroupTemplateMemberInput.shape.key,
  })
  .strict();

export const removeSuperGroupTemplateMember = async (
  db: LobeChatDatabase,
  operatorUserId: string,
  input: z.input<typeof removeSuperGroupTemplateMemberInput>,
) => {
  const { key } = removeSuperGroupTemplateMemberInput.parse(input);
  return publishTemplate(db, operatorUserId, async (previous) => {
    if (!previous.members.some((member) => member.key === key))
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Published member not found' });
    return previous.members.filter((member) => member.key !== key);
  });
};

const readPublishableMember = async (
  tx: LobeChatDatabase,
  operatorUserId: string,
  parsed: z.input<typeof importSuperGroupTemplateMemberInput>,
  previous: SuperGroupTemplate,
): Promise<SuperGroupTemplateMember> => {
  const original = await tx.query.agents.findFirst({
    where: and(
      eq(agents.id, parsed.agentId),
      eq(agents.userId, operatorUserId),
      isNull(agents.workspaceId),
      isNull(agents.deletedAt),
    ),
  });
  if (!original) throw new TRPCError({ code: 'NOT_FOUND', message: 'Owned member not found' });
  const pending: string[] = [];
  if ((!original.model || !original.provider) && !parsed.allowPending)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Member must use a server-available model and provider',
    });
  if (!original.model || !original.provider) pending.push('原成员尚未明确指定模型与服务商');
  if (
    original.agencyConfig?.boundDeviceId ||
    original.agencyConfig?.heterogeneousProvider ||
    ['device', 'local'].includes(original.agencyConfig?.executionTarget ?? '')
  ) {
    if (!parsed.allowPending)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: '设备或本地 CLI 成员不能同步给所有用户，请先配置服务器模型。',
      });
    pending.push('原成员绑定本机运行环境，待配置服务器运行环境');
  }
  const existing = previous.members.find((item) => item.sourceAgentId === original.id);
  const key = parsed.key ?? existing?.key ?? randomUUID();
  const skills: NonNullable<SuperGroupTemplateMember['skills']> = [];
  const plugins: string[] = [];
  const pluginBindings: AgentPluginEntry[] = [];
  const builtinIds = new Set(builtinTools.map((tool) => tool.identifier));
  for (const entry of z.array(AgentPluginEntrySchema).parse(original.plugins ?? [])) {
    const identifier = typeof entry === 'string' ? entry : entry.identifier;
    if (builtinIds.has(identifier)) {
      plugins.push(identifier);
      pluginBindings.push(entry);
      continue;
    }
    const skill = await tx.query.agentSkills.findFirst({
      where: and(
        eq(agentSkills.identifier, identifier),
        eq(agentSkills.userId, operatorUserId),
        isNull(agentSkills.workspaceId),
        isNull(agentSkills.deletedAt),
      ),
    });
    const publishedIdentifier = `supergroup-${key}-${identifier}`;
    const priorSkill = (existing ?? previous.supervisor)?.skills?.find(
      (item) => item.identifier === publishedIdentifier,
    );
    const hasResources = !!skill?.zipFileHash || Object.keys(skill?.resources ?? {}).length > 0;
    const approvedResources =
      parsed.publishResourceSkills?.includes(identifier) ||
      (!!priorSkill &&
        isEqual(priorSkill.resources ?? {}, skill?.resources ?? {}) &&
        (priorSkill.zipFileHash ?? null) === (skill?.zipFileHash ?? null));
    if (!skill || (hasResources && !approvedResources)) {
      if (!parsed.allowPending)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `成员包含需单独发布的连接器或资源技能：${identifier}。未同步任何更改。`,
        });
      pending.push(`原工具或技能资源待发布：${identifier}`);
      // Keep the original binding for inspection, but block execution below.
      plugins.push(identifier);
      pluginBindings.push(entry);
      continue;
    }
    if (hasResources) {
      const hashes = [
        ...new Set([
          ...(skill.zipFileHash ? [skill.zipFileHash] : []),
          ...Object.values(skill.resources ?? {}).map((resource) => resource.fileHash),
        ]),
      ];
      const stored = await tx
        .select({ hash: globalFiles.hashId })
        .from(globalFiles)
        .where(inArray(globalFiles.hashId, hashes));
      if (stored.length !== hashes.length)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `技能资源文件缺失：${identifier}。未同步任何更改。`,
        });
    }
    skills.push({
      identifier: publishedIdentifier,
      name: `${skill.name} [${key}]`,
      description: skill.description,
      content: skill.content ?? '',
      source: skill.source,
      ...(hasResources ? { resources: skill.resources ?? {}, zipFileHash: skill.zipFileHash } : {}),
    });
    plugins.push(publishedIdentifier);
    pluginBindings.push(
      typeof entry === 'string'
        ? publishedIdentifier
        : { ...entry, identifier: publishedIdentifier },
    );
  }
  // Publish explicit portable fields only; no metadata, device bindings, credentials or private files.
  const params = Object.fromEntries(
    Object.entries(original.params ?? {}).filter(
      ([key, value]) =>
        ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'max_tokens'].includes(
          key,
        ) &&
        typeof value === 'number' &&
        Number.isFinite(value),
    ),
  ) as Record<string, number>;
  return {
    avatar: original.avatar,
    backgroundColor: original.backgroundColor,
    description: original.description ?? '',
    key,
    model: original.model ?? undefined,
    name: original.name?.trim() || '',
    provider: original.provider ?? undefined,
    pendingReason: pending.length ? pending.join('；') : undefined,
    params,
    plugins,
    pluginBindings,
    skills,
    sourceAgentId: original.id,
    systemRole: original.systemRole ?? '',
    title: original.title?.trim() || original.name?.trim() || '成员',
  };
};

export const importSuperGroupTemplateMember = async (
  db: LobeChatDatabase,
  operatorUserId: string,
  input: z.input<typeof importSuperGroupTemplateMemberInput>,
) => {
  const parsed = importSuperGroupTemplateMemberInput.parse(input);
  let member!: SuperGroupTemplateMember;
  const result = await publishTemplate(db, operatorUserId, async (previous, tx) => {
    member = await readPublishableMember(tx, operatorUserId, parsed, previous);
    const index = previous.members.findIndex(
      (item) => item.key === member.key || item.sourceAgentId === member.sourceAgentId,
    );
    const members = previous.members.filter(
      (item) => item.key !== member.key && item.sourceAgentId !== member.sourceAgentId,
    );
    members.splice(index < 0 ? members.length : index, 0, member);
    return members;
  });
  return { ...result, member };
};

/** Save the canonical member and publish atomically, including edits made from a group copy. */
export const savePublishedSuperGroupAgent = async (
  db: LobeChatDatabase,
  userId: string,
  agentId: string,
  value: Parameters<AgentModel['updateConfig']>[1],
): Promise<boolean> => {
  // Match AgentModel.updateConfig: an absent patch is a no-op, not a publication.
  if (value === null || value === undefined) return false;

  return db
    .transaction(async (transaction) => {
      const tx = transaction as LobeChatDatabase;
      await lockSuperGroupTemplate(tx);
      const target = await tx.query.agents.findFirst({
        where: and(
          eq(agents.id, agentId),
          eq(agents.userId, userId),
          isNull(agents.workspaceId),
          isNull(agents.deletedAt),
        ),
      });
      if (!target) return false;
      const template = await getSuperGroupTemplate(tx);
      const isSupervisor = target.slug === GROUP_SUPERVISOR.slug;
      const member:
        (Pick<SuperGroupTemplateMember, 'key'> & Partial<SuperGroupTemplateMember>) | undefined =
        isSupervisor
          ? (template.supervisor ?? { key: 'travel-owner' })
          : template.members.find(
              (item) =>
                item.sourceAgentId === agentId ||
                getSuperGroupTemplateMemberClientId(item.key) === target.clientId,
            );
      if (!member) return false;
      if (!(await hasActivePlatformAdminAccess(tx, userId)))
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Platform administrator access is required',
        });
      const sourceId = member.sourceAgentId ?? agentId;
      const source = await tx.query.agents.findFirst({
        where: and(
          eq(agents.id, sourceId),
          eq(agents.userId, userId),
          isNull(agents.workspaceId),
          isNull(agents.deletedAt),
        ),
      });
      if (!source)
        throw new TRPCError({ code: 'FORBIDDEN', message: '请由原模板成员所属管理员修改此配置。' });
      const portableFields = [
        'avatar',
        'backgroundColor',
        'name',
        'title',
        'description',
        'systemRole',
        'model',
        'provider',
        'params',
        'plugins',
        'agencyConfig',
      ];
      for (const [field, next] of Object.entries(value ?? {})) {
        if (
          !portableFields.includes(field) &&
          next !== undefined &&
          !isEqual(next, source[field as keyof typeof source])
        )
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `模板暂不支持同步此设置：${field}。本次未保存任何更改。`,
          });
      }
      for (const [field, next] of Object.entries(value?.params ?? {})) {
        if (
          !['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'max_tokens'].includes(
            field,
          ) &&
          !isEqual(next, (source.params as Record<string, unknown> | null)?.[field])
        )
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `模板暂不支持同步此模型参数：${field}。本次未保存任何更改。`,
          });
      }
      for (const [field, next] of Object.entries(value?.agencyConfig ?? {})) {
        if (
          !['modelRuntimeMode', 'modelSelectionPolicy'].includes(field) &&
          !isEqual(next, (source.agencyConfig as Record<string, unknown> | null)?.[field])
        )
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `模板暂不支持同步此运行环境设置：${field}。本次未保存任何更改。`,
          });
      }
      // Group copies bind published skill identifiers; the source must keep its original bindings.
      const plugins =
        value?.plugins &&
        z
          .array(AgentPluginEntrySchema)
          .parse(value.plugins)
          .map((entry) => {
            const identifier = typeof entry === 'string' ? entry : entry.identifier;
            const prefix = `supergroup-${member.key}-`;
            const originalIdentifier = member.skills?.some(
              (skill) => skill.identifier === identifier,
            )
              ? identifier.slice(prefix.length)
              : identifier;
            return typeof entry === 'string'
              ? originalIdentifier
              : { ...entry, identifier: originalIdentifier };
          });
      await new AgentModel(tx, userId).updateConfig(sourceId, {
        ...value,
        ...(plugins ? { plugins: plugins as string[] } : {}),
      });
      // Presentation edits must not republish unrelated private tools or clear an
      // existing publication block. Keep the previously published runtime intact.
      const publishedMember = isSupervisor
        ? template.supervisor
        : template.members.find((item) => item.key === member.key);
      const presentationOnly = Object.entries(value ?? {}).every(
        ([field, next]) =>
          next === undefined ||
          ['avatar', 'backgroundColor', 'name', 'title', 'description'].includes(field),
      );
      if (publishedMember && presentationOnly) {
        const presentation: SuperGroupTemplateMember = {
          ...publishedMember,
          ...(value.avatar !== undefined ? { avatar: value.avatar } : {}),
          ...(value.backgroundColor !== undefined
            ? { backgroundColor: value.backgroundColor }
            : {}),
          ...(value.name !== undefined ? { name: value.name?.trim() || '' } : {}),
          ...(value.title !== undefined
            ? { title: value.title?.trim() || (value.name ?? source.name)?.trim() || '成员' }
            : {}),
          ...(value.description !== undefined ? { description: value.description ?? '' } : {}),
        };
        await publishTemplate(
          tx,
          userId,
          async (previous) =>
            isSupervisor
              ? previous.members
              : previous.members.map((item) => (item.key === member.key ? presentation : item)),
          isSupervisor ? presentation : undefined,
        );
        return true;
      }
      if (isSupervisor) {
        const supervisor = await readPublishableMember(
          tx,
          userId,
          { agentId: sourceId, key: 'travel-owner' },
          template,
        );
        await publishTemplate(tx, userId, async (previous) => previous.members, supervisor);
      } else {
        await importSuperGroupTemplateMember(tx, userId, { agentId: sourceId, key: member.key });
      }
      return true;
    })
    .catch((error: unknown) => {
      if (error instanceof TRPCError)
        throw new TRPCError({ code: error.code, message: `模板自动同步失败：${error.message}` });
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: '模板自动同步失败：保存未完成，请重试。',
      });
    });
};

/** Text-skill edits and re-imports republish all bound members in the same transaction. */
export const saveSkillWithSuperGroupTemplate = async (
  db: LobeChatDatabase,
  userId: string,
  skillId: string,
  value: Parameters<AgentSkillModel['update']>[1],
  workspaceId?: string,
) => {
  if (workspaceId) return new AgentSkillModel(db, userId, workspaceId).update(skillId, value);
  return db
    .transaction(async (transaction) => {
      const tx = transaction as LobeChatDatabase;
      await lockSuperGroupTemplate(tx);
      const model = new AgentSkillModel(tx, userId);
      const target = await model.findById(skillId);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
      const template = await getSuperGroupTemplate(tx);
      const members = [...template.members, ...(template.supervisor ? [template.supervisor] : [])];
      const publishedMember = members.find((member) =>
        member.skills?.some((skill) => skill.identifier === target.identifier),
      );
      const originalIdentifier = publishedMember
        ? target.identifier.slice(`supergroup-${publishedMember.key}-`.length)
        : target.identifier;
      const original = publishedMember ? await model.findByIdentifier(originalIdentifier) : target;
      if (!original)
        throw new TRPCError({ code: 'FORBIDDEN', message: '请由原技能所属管理员修改此配置。' });
      const sourceIds = members.flatMap((member) =>
        member.sourceAgentId ? [member.sourceAgentId] : [],
      );
      const sources = sourceIds.length
        ? await tx.query.agents.findMany({
            where: and(
              inArray(agents.id, sourceIds),
              eq(agents.userId, userId),
              isNull(agents.workspaceId),
              isNull(agents.deletedAt),
            ),
          })
        : [];
      const affected = sources.filter((source) =>
        z
          .array(AgentPluginEntrySchema)
          .parse(source.plugins ?? [])
          .some(
            (entry) =>
              (typeof entry === 'string' ? entry : entry.identifier) === originalIdentifier,
          ),
      );
      if ((publishedMember || affected.length) && !(await hasActivePlatformAdminAccess(tx, userId)))
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Platform administrator access is required',
        });
      if (
        publishedMember &&
        !affected.some((source) => source.id === publishedMember.sourceAgentId)
      )
        throw new TRPCError({ code: 'FORBIDDEN', message: '请由原模板成员所属管理员修改此技能。' });
      const updated = await model.update(original.id, value);
      for (const source of affected) {
        if (source.id === template.supervisor?.sourceAgentId) {
          const supervisor = await readPublishableMember(
            tx,
            userId,
            { agentId: source.id, key: 'travel-owner' },
            template,
          );
          await publishTemplate(tx, userId, async (previous) => previous.members, supervisor);
        } else {
          await importSuperGroupTemplateMember(tx, userId, { agentId: source.id });
        }
      }
      return publishedMember ? (await model.findById(skillId))! : updated;
    })
    .catch((error: unknown) => {
      if (error instanceof TRPCError)
        throw new TRPCError({ code: error.code, message: `模板自动同步失败：${error.message}` });
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: '模板自动同步失败：技能保存未完成，请重试。',
      });
    });
};
