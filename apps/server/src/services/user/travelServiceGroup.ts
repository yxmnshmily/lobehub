import { GROUP_SUPERVISOR, INBOX } from '@lobechat/builtin-agents';
import { TravelProductionIdentifier } from '@lobechat/builtin-tool-travel-production';
import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import { agents, chatGroups, chatGroupsAgents, users } from '@lobechat/database/schemas';
import { AgentPluginEntrySchema, parsePluginEntry } from '@lobechat/types';
import { and, eq, inArray, isNull, like, ne, or, sql } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import { AgentModel } from '@/database/models/agent';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { ChatGroupModel } from '@/database/models/chatGroup';
import type { ChatGroupConfig } from '@/database/types/chatGroup';
import { authEnv } from '@/envs/auth';

import {
  applySuperGroupTemplate,
  getSuperGroupTemplate,
  lockSuperGroupTemplate,
} from './travelServiceGroupTemplate';

export const DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID = 'default-travel-service-group';
export const DEFAULT_TRAVEL_GROUP_SUPERVISOR_TITLE = '旅游群主AI';
const LEGACY_TRAVEL_GROUP_SYSTEM_PROMPT = `你在这个群组中的用户可见身份是“旅游群主AI”，负责统筹旅游服务内容与制作任务。

- 根据用户需求，将文案、图片封面、视频、行程文档交给群内对应的制作助理，然后向用户汇总最终结果。
- 不向用户暴露内部 Agent ID、平台密钥、调度标记或系统实现细节。
- 未实际生成的图片、视频或文档不得宣称已完成；信息不足时先请用户补充。
- 默认使用用户的语言回复，旅游地名、行程、价格和时刻等不得虚构。`;

export const DEFAULT_TRAVEL_GROUP_SYSTEM_PROMPT = `${LEGACY_TRAVEL_GROUP_SYSTEM_PROMPT}

- 你的首要职责是整个超级工作群的协作架构与讨论秩序：明确各助理的职责、任务分工、协作顺序和交付标准，避免重复工作和互相干扰。
- 遇到意见冲突时，先澄清各方依据与共同目标，协调分歧、汇总可执行结论；不要参与争吵，不要让助理反复互相争论。需要人作决定时，请真人群主确认。
- 群架构建议不等于管理权限：你不能擅自添加或删除助理、改变成员权限、踢出真人成员或删除话题和聊天记录。助理结构由平台管理员统一维护，真人成员管理遵守群主权限。`;

const TRAVEL_GROUP_SUPERVISOR_DESCRIPTION =
  '负责超级工作群的协作架构、任务分工与讨论秩序，协调分歧，避免争吵，并汇总群内助理的工作成果。';

export const TRAVEL_SPECIALIST_TEMPLATES = [
  {
    clientId: 'default-travel-copywriter',
    description: '按照旅游业务目标产出可发布、可口播的文案。',
    key: 'copywriter',
    label: '旅游文案助理',
    plugins: [TravelProductionIdentifier],
    skillSlots: ['tourism-copywriting'],
    skillContent: `# 旅游文案制作

1. 先确认目的地、客群、渠道和篇幅。
2. 以准确行程信息为基础，生成标题、正文、口播或营销脚本。
3. 禁止虚构价格、时刻、酒店和交通信息；不确定时明确标注待确认。
4. 交付前检查目的地一致性、行动号召和口语化程度。`,
    systemRole: '你是旅游文案助理，负责口播、攻略、标题、推文和营销脚本。',
  },
  {
    clientId: 'default-travel-image-designer',
    description: '为旅游海报、封面和配图产出可执行的视觉方案。',
    key: 'designer',
    label: '图片封面助理',
    plugins: [TravelProductionIdentifier],
    skillSlots: ['tourism-visual-design'],
    skillContent: `# 旅游视觉设计

1. 确认平台尺寸、主题、目的地和必须出现的文字。
2. 先输出构图、色彩、字体层级和图像生成提示词，再调用图像生成工具。
3. 对地标、景点和民俗元素保持地域准确性。
4. 检查文字可读性、主体安全区和商业使用风险。`,
    systemRole: '你是旅游图片封面助理，负责旅游海报、封面、配图的视觉方案与图像生成。',
  },
  {
    clientId: 'default-travel-video-producer',
    description: '将旅游素材组织为可拍摄、可剪辑的短视频方案。',
    key: 'video-producer',
    label: '旅游视频助理',
    plugins: [TravelProductionIdentifier],
    skillSlots: ['tourism-video-production'],
    skillContent: `# 旅游视频制作

1. 明确时长、画幅比例、发布平台和核心卖点。
2. 按时间轴输出镜头、景别、画面、口播、字幕、音效和转场。
3. 优先使用已有真实素材，不虚构未提供的航拍或景点画面。
4. 交付剪辑清单、素材缺口和成片验收点。`,
    systemRole: '你是旅游视频助理，负责选题、分镜、剪辑脚本、口播与成片制作流程。',
  },
  {
    clientId: 'default-travel-document-assistant',
    description: '结构化生成行程单、方案书、报价单和旅游手册。',
    key: 'document-assistant',
    label: '行程文档助理',
    plugins: [TravelProductionIdentifier, 'lobe-agent-documents'],
    skillSlots: ['tourism-document-production'],
    skillContent: `# 旅游文档制作

1. 先确认文档用途、读者、纸张或屏幕格式和必备章节。
2. 行程按天组织，明确交通、景点、餐饮、住宿、时长和注意事项。
3. 报价严格区分包含、不含、可选项和退改条件。
4. 输出前检查目录、标题层级、分页、表格和中英文混排。`,
    systemRole: '你是行程文档助理，负责行程单、方案书、报价单、手册和 Word/PDF 文档内容。',
  },
] as const;

export type DefaultTravelServiceGroupRequiredMemberKey =
  (typeof TRAVEL_SPECIALIST_TEMPLATES)[number]['key'];

export const DEFAULT_TRAVEL_SERVICE_GROUP_HEALTH_ISSUE_CODES = [
  'DEFAULT_GROUP_MISSING',
  'DEFAULT_GROUP_DUPLICATED',
  'DEFAULT_GROUP_NOT_PRIVATE',
  'DEFAULT_GROUP_INSTRUCTIONS_MISSING',
  'DEFAULT_GROUP_SCOPE_INVALID',
  'SUPERVISOR_COUNT_INVALID',
  'LEGACY_INBOX_SUPERVISOR',
  'SUPERVISOR_IDENTITY_INVALID',
  'SUPERVISOR_DISABLED',
  'SUPERVISOR_TITLE_INVALID',
  'SUPERVISOR_NOT_PLATFORM_MANAGED',
  'COPYWRITER_MISSING',
  'COPYWRITER_DUPLICATED',
  'COPYWRITER_DISABLED',
  'COPYWRITER_NOT_PLATFORM_MANAGED',
  'COPYWRITER_SKILL_BINDING_MISSING',
  'COPYWRITER_TOOL_BINDING_MISSING',
  'COPYWRITER_TEMPLATE_MISMATCH',
  'DESIGNER_MISSING',
  'DESIGNER_DUPLICATED',
  'DESIGNER_DISABLED',
  'DESIGNER_NOT_PLATFORM_MANAGED',
  'DESIGNER_SKILL_BINDING_MISSING',
  'DESIGNER_TOOL_BINDING_MISSING',
  'DESIGNER_TEMPLATE_MISMATCH',
  'VIDEO_PRODUCER_MISSING',
  'VIDEO_PRODUCER_DUPLICATED',
  'VIDEO_PRODUCER_DISABLED',
  'VIDEO_PRODUCER_NOT_PLATFORM_MANAGED',
  'VIDEO_PRODUCER_SKILL_BINDING_MISSING',
  'VIDEO_PRODUCER_TOOL_BINDING_MISSING',
  'VIDEO_PRODUCER_TEMPLATE_MISMATCH',
  'DOCUMENT_ASSISTANT_MISSING',
  'DOCUMENT_ASSISTANT_DUPLICATED',
  'DOCUMENT_ASSISTANT_DISABLED',
  'DOCUMENT_ASSISTANT_NOT_PLATFORM_MANAGED',
  'DOCUMENT_ASSISTANT_SKILL_BINDING_MISSING',
  'DOCUMENT_ASSISTANT_TOOL_BINDING_MISSING',
  'DOCUMENT_ASSISTANT_TEMPLATE_MISMATCH',
  'PUBLISHED_TEMPLATE_MEMBERS_OUT_OF_SYNC',
  'PUBLISHED_TEMPLATE_MEMBERS_REVIEW_REQUIRED',
] as const;

export type DefaultTravelServiceGroupHealthIssueCode =
  (typeof DEFAULT_TRAVEL_SERVICE_GROUP_HEALTH_ISSUE_CODES)[number];

export interface DefaultTravelServiceGroupHealthSummary {
  groupCount: number;
  healthy: boolean;
  isPrivate: boolean;
  issueCodes: DefaultTravelServiceGroupHealthIssueCode[];
  requiredMembers: Record<
    DefaultTravelServiceGroupRequiredMemberKey,
    { enabled: boolean; exists: boolean; platformManaged: boolean }
  >;
  supervisor: { count: number; platformManaged: boolean; titleMatches: boolean };
}

export interface DefaultTravelServiceGroupHealthTarget {
  targetUserId: string;
  workspaceId?: string | null;
}

export const DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES = [
  'CREATE_DEFAULT_GROUP',
  'SET_PRIVATE',
  'ENSURE_GROUP_INSTRUCTIONS',
  'ENSURE_SUPERVISOR',
  'MIGRATE_LEGACY_INBOX_SUPERVISOR',
  'RENAME_SUPERVISOR',
  'MARK_PLATFORM_MANAGED',
  'ENSURE_REQUIRED_MEMBER',
  'ENABLE_REQUIRED_MEMBER',
  'APPLY_PUBLISHED_TEMPLATE',
  'REMOVE_DUPLICATE_REVIEW_REQUIRED',
  'SUPERVISOR_REVIEW_REQUIRED',
  'UNKNOWN_ISSUE_REVIEW_REQUIRED',
] as const;

export type DefaultTravelServiceGroupRepairActionCode =
  (typeof DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES)[number];

export type DefaultTravelServiceGroupRepairTarget =
  'group' | 'supervisor' | DefaultTravelServiceGroupRequiredMemberKey | 'unknown';

export interface DefaultTravelServiceGroupRepairAction {
  code: DefaultTravelServiceGroupRepairActionCode;
  reviewRequired: boolean;
  target: DefaultTravelServiceGroupRepairTarget;
}

export interface DefaultTravelServiceGroupRepairPlan {
  actions: DefaultTravelServiceGroupRepairAction[];
  reviewRequired: boolean;
}

export const SAFE_DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES = [
  'CREATE_DEFAULT_GROUP',
  'SET_PRIVATE',
  'ENSURE_GROUP_INSTRUCTIONS',
  'ENSURE_SUPERVISOR',
  'MIGRATE_LEGACY_INBOX_SUPERVISOR',
  'RENAME_SUPERVISOR',
  'MARK_PLATFORM_MANAGED',
  'ENSURE_REQUIRED_MEMBER',
  'ENABLE_REQUIRED_MEMBER',
  'APPLY_PUBLISHED_TEMPLATE',
] as const;

export type SafeDefaultTravelServiceGroupRepairActionCode =
  (typeof SAFE_DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES)[number];

export interface ExecuteDefaultTravelServiceGroupRepairPlanInput extends DefaultTravelServiceGroupHealthTarget {
  expectedPlan: DefaultTravelServiceGroupRepairPlan;
}

export interface ExecuteDefaultTravelServiceGroupRepairPlanResult {
  actionCounts: Array<{ code: SafeDefaultTravelServiceGroupRepairActionCode; count: number }>;
  finalHealth: DefaultTravelServiceGroupHealthSummary;
}

export const TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED = 'TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED';
export const TRAVEL_GROUP_REPAIR_ACTION_NOT_ALLOWED = 'TRAVEL_GROUP_REPAIR_ACTION_NOT_ALLOWED';
export const TRAVEL_GROUP_REPAIR_STATE_CHANGED = 'TRAVEL_GROUP_REPAIR_STATE_CHANGED';
export const TRAVEL_GROUP_REPAIR_SCOPE_INVALID = 'TRAVEL_GROUP_REPAIR_SCOPE_INVALID';
export const TRAVEL_GROUP_REPAIR_EXECUTION_FAILED = 'TRAVEL_GROUP_REPAIR_EXECUTION_FAILED';

const knownHealthIssueCodes = new Set<string>(DEFAULT_TRAVEL_SERVICE_GROUP_HEALTH_ISSUE_CODES);

const repairActionForIssue = (
  issueCode: DefaultTravelServiceGroupHealthIssueCode,
  summary: DefaultTravelServiceGroupHealthSummary,
): DefaultTravelServiceGroupRepairAction => {
  switch (issueCode) {
    case 'DEFAULT_GROUP_MISSING': {
      return { code: 'CREATE_DEFAULT_GROUP', reviewRequired: false, target: 'group' };
    }
    case 'DEFAULT_GROUP_DUPLICATED': {
      return {
        code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED',
        reviewRequired: true,
        target: 'group',
      };
    }
    case 'DEFAULT_GROUP_NOT_PRIVATE': {
      return { code: 'SET_PRIVATE', reviewRequired: false, target: 'group' };
    }
    case 'DEFAULT_GROUP_INSTRUCTIONS_MISSING': {
      return { code: 'ENSURE_GROUP_INSTRUCTIONS', reviewRequired: false, target: 'group' };
    }
    case 'DEFAULT_GROUP_SCOPE_INVALID': {
      return { code: 'UNKNOWN_ISSUE_REVIEW_REQUIRED', reviewRequired: true, target: 'group' };
    }
    case 'SUPERVISOR_COUNT_INVALID': {
      return summary.supervisor.count === 0
        ? { code: 'ENSURE_SUPERVISOR', reviewRequired: false, target: 'supervisor' }
        : { code: 'SUPERVISOR_REVIEW_REQUIRED', reviewRequired: true, target: 'supervisor' };
    }
    case 'LEGACY_INBOX_SUPERVISOR': {
      return {
        code: 'MIGRATE_LEGACY_INBOX_SUPERVISOR',
        reviewRequired: false,
        target: 'supervisor',
      };
    }
    case 'SUPERVISOR_IDENTITY_INVALID': {
      return { code: 'SUPERVISOR_REVIEW_REQUIRED', reviewRequired: true, target: 'supervisor' };
    }
    case 'SUPERVISOR_DISABLED': {
      return { code: 'ENSURE_SUPERVISOR', reviewRequired: false, target: 'supervisor' };
    }
    case 'SUPERVISOR_TITLE_INVALID': {
      return { code: 'RENAME_SUPERVISOR', reviewRequired: false, target: 'supervisor' };
    }
    case 'SUPERVISOR_NOT_PLATFORM_MANAGED': {
      return { code: 'MARK_PLATFORM_MANAGED', reviewRequired: false, target: 'supervisor' };
    }
    case 'COPYWRITER_MISSING': {
      return { code: 'ENSURE_REQUIRED_MEMBER', reviewRequired: false, target: 'copywriter' };
    }
    case 'COPYWRITER_DUPLICATED': {
      return {
        code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED',
        reviewRequired: true,
        target: 'copywriter',
      };
    }
    case 'COPYWRITER_DISABLED': {
      return { code: 'ENABLE_REQUIRED_MEMBER', reviewRequired: false, target: 'copywriter' };
    }
    case 'COPYWRITER_NOT_PLATFORM_MANAGED': {
      return { code: 'MARK_PLATFORM_MANAGED', reviewRequired: false, target: 'copywriter' };
    }
    case 'COPYWRITER_TOOL_BINDING_MISSING': {
      return { code: 'ENSURE_REQUIRED_MEMBER', reviewRequired: false, target: 'copywriter' };
    }
    case 'COPYWRITER_TEMPLATE_MISMATCH': {
      return { code: 'ENSURE_REQUIRED_MEMBER', reviewRequired: false, target: 'copywriter' };
    }
    case 'COPYWRITER_SKILL_BINDING_MISSING': {
      return { code: 'ENSURE_REQUIRED_MEMBER', reviewRequired: false, target: 'copywriter' };
    }
    case 'DESIGNER_MISSING': {
      return { code: 'ENSURE_REQUIRED_MEMBER', reviewRequired: false, target: 'designer' };
    }
    case 'DESIGNER_DUPLICATED': {
      return {
        code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED',
        reviewRequired: true,
        target: 'designer',
      };
    }
    case 'DESIGNER_DISABLED': {
      return { code: 'ENABLE_REQUIRED_MEMBER', reviewRequired: false, target: 'designer' };
    }
    case 'DESIGNER_NOT_PLATFORM_MANAGED': {
      return { code: 'MARK_PLATFORM_MANAGED', reviewRequired: false, target: 'designer' };
    }
    case 'DESIGNER_SKILL_BINDING_MISSING':
    case 'DESIGNER_TOOL_BINDING_MISSING':
    case 'DESIGNER_TEMPLATE_MISMATCH': {
      return { code: 'ENSURE_REQUIRED_MEMBER', reviewRequired: false, target: 'designer' };
    }
    case 'VIDEO_PRODUCER_MISSING': {
      return {
        code: 'ENSURE_REQUIRED_MEMBER',
        reviewRequired: false,
        target: 'video-producer',
      };
    }
    case 'VIDEO_PRODUCER_DUPLICATED': {
      return {
        code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED',
        reviewRequired: true,
        target: 'video-producer',
      };
    }
    case 'VIDEO_PRODUCER_DISABLED': {
      return {
        code: 'ENABLE_REQUIRED_MEMBER',
        reviewRequired: false,
        target: 'video-producer',
      };
    }
    case 'VIDEO_PRODUCER_NOT_PLATFORM_MANAGED': {
      return { code: 'MARK_PLATFORM_MANAGED', reviewRequired: false, target: 'video-producer' };
    }
    case 'VIDEO_PRODUCER_SKILL_BINDING_MISSING':
    case 'VIDEO_PRODUCER_TOOL_BINDING_MISSING':
    case 'VIDEO_PRODUCER_TEMPLATE_MISMATCH': {
      return {
        code: 'ENSURE_REQUIRED_MEMBER',
        reviewRequired: false,
        target: 'video-producer',
      };
    }
    case 'DOCUMENT_ASSISTANT_MISSING': {
      return {
        code: 'ENSURE_REQUIRED_MEMBER',
        reviewRequired: false,
        target: 'document-assistant',
      };
    }
    case 'DOCUMENT_ASSISTANT_DUPLICATED': {
      return {
        code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED',
        reviewRequired: true,
        target: 'document-assistant',
      };
    }
    case 'DOCUMENT_ASSISTANT_DISABLED': {
      return {
        code: 'ENABLE_REQUIRED_MEMBER',
        reviewRequired: false,
        target: 'document-assistant',
      };
    }
    case 'DOCUMENT_ASSISTANT_NOT_PLATFORM_MANAGED': {
      return {
        code: 'MARK_PLATFORM_MANAGED',
        reviewRequired: false,
        target: 'document-assistant',
      };
    }
    case 'DOCUMENT_ASSISTANT_SKILL_BINDING_MISSING':
    case 'DOCUMENT_ASSISTANT_TOOL_BINDING_MISSING':
    case 'DOCUMENT_ASSISTANT_TEMPLATE_MISMATCH': {
      return {
        code: 'ENSURE_REQUIRED_MEMBER',
        reviewRequired: false,
        target: 'document-assistant',
      };
    }
    case 'PUBLISHED_TEMPLATE_MEMBERS_OUT_OF_SYNC': {
      return { code: 'APPLY_PUBLISHED_TEMPLATE', reviewRequired: false, target: 'group' };
    }
    case 'PUBLISHED_TEMPLATE_MEMBERS_REVIEW_REQUIRED': {
      return { code: 'UNKNOWN_ISSUE_REVIEW_REQUIRED', reviewRequired: true, target: 'group' };
    }
  }
};

/**
 * Builds a deterministic, data-free repair preview from a health summary.
 * This function never performs writes. A caller must not automatically apply
 * any plan whose `reviewRequired` flag is true.
 */
export const buildDefaultTravelServiceGroupRepairPlan = (
  summary: DefaultTravelServiceGroupHealthSummary,
): DefaultTravelServiceGroupRepairPlan => {
  if (summary.issueCodes.some((issueCode) => !knownHealthIssueCodes.has(issueCode))) {
    return {
      actions: [{ code: 'UNKNOWN_ISSUE_REVIEW_REQUIRED', reviewRequired: true, target: 'unknown' }],
      reviewRequired: true,
    };
  }

  const presentIssueCodes = new Set(summary.issueCodes);
  const actions: DefaultTravelServiceGroupRepairAction[] = [];
  for (const issueCode of DEFAULT_TRAVEL_SERVICE_GROUP_HEALTH_ISSUE_CODES) {
    if (!presentIssueCodes.has(issueCode)) continue;
    const action = repairActionForIssue(issueCode, summary);
    if (actions.some(({ code, target }) => code === action.code && target === action.target)) {
      continue;
    }
    actions.push(action);
  }

  return {
    actions,
    reviewRequired: actions.some(({ reviewRequired }) => reviewRequired),
  };
};

const REQUIRED_TRAVEL_SPECIALIST_CLIENT_IDS: ReadonlySet<string> = new Set(
  TRAVEL_SPECIALIST_TEMPLATES.map(({ clientId }) => clientId),
);

export const isDefaultTravelServiceGroupClientId = (clientId: string | null | undefined) =>
  clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID;

export const isRequiredTravelServiceAgentIdentity = ({
  clientId,
  slug,
}: {
  clientId?: string | null;
  slug?: string | null;
}) =>
  slug === GROUP_SUPERVISOR.slug ||
  REQUIRED_TRAVEL_SPECIALIST_CLIENT_IDS.has(clientId ?? '') ||
  clientId?.startsWith('supergroup-template-') === true;

const isPlatformManagedAgent = (agencyConfig: (typeof agents.$inferSelect)['agencyConfig']) =>
  agencyConfig?.modelRuntimeMode === 'platform-managed' &&
  agencyConfig.modelSelectionPolicy === 'fixed';

export const getSuperGroupTemplateMemberClientId = (key: string) =>
  TRAVEL_SPECIALIST_TEMPLATES.find((item) => item.key === key)?.clientId ??
  `supergroup-template-${key}`;

type PublishedTemplateMemberCandidate = {
  agencyConfig: (typeof agents.$inferSelect)['agencyConfig'];
  avatar: string | null;
  backgroundColor: string | null;
  description: string | null;
  model: string | null;
  name: string | null;
  params: (typeof agents.$inferSelect)['params'];
  plugins: (typeof agents.$inferSelect)['plugins'];
  provider: string | null;
  systemRole: string | null;
  title: string | null;
};

const normalizedPluginBindings = (plugins: unknown) => {
  const parsed = AgentPluginEntrySchema.array().safeParse(plugins ?? []);
  return parsed.success
    ? parsed.data
        .map(parsePluginEntry)
        .sort((a, b) => a.identifier.localeCompare(b.identifier) || a.mode.localeCompare(b.mode))
    : null;
};

const matchesPublishedTemplateMember = (
  candidate: PublishedTemplateMemberCandidate,
  member: Awaited<ReturnType<typeof getSuperGroupTemplate>>['members'][number],
) => {
  const actualPlugins = normalizedPluginBindings(candidate.plugins);
  const builtin = TRAVEL_SPECIALIST_TEMPLATES.find(({ key }) => key === member.key);
  const expectedPlugins = normalizedPluginBindings(
    member.pluginBindings ?? [
      ...new Set([...member.plugins, ...(member.sourceAgentId ? [] : (builtin?.skillSlots ?? []))]),
    ],
  );
  return (
    isPlatformManagedAgent(candidate.agencyConfig) &&
    (!member.model || candidate.model === member.model) &&
    (!member.provider || candidate.provider === member.provider) &&
    (!member.params || isEqual(candidate.params ?? {}, member.params)) &&
    candidate.avatar === member.avatar &&
    (member.backgroundColor === undefined ||
      candidate.backgroundColor === member.backgroundColor) &&
    candidate.description ===
      (member.pendingReason ? `【加入】\n${member.description}` : member.description) &&
    candidate.agencyConfig?.publicationBlockedReason === member.pendingReason &&
    candidate.systemRole === member.systemRole &&
    candidate.title === member.title &&
    (member.name === undefined || candidate.name === (member.name || null)) &&
    actualPlugins !== null &&
    expectedPlugins !== null &&
    isEqual(actualPlugins, expectedPlugins)
  );
};

const getRequiredMemberBindingDiagnostic = (
  template: (typeof TRAVEL_SPECIALIST_TEMPLATES)[number],
  plugins: unknown,
  skillExists: boolean,
) => {
  const activePlugins = (normalizedPluginBindings(plugins) ?? [])
    .filter(({ mode }) => mode === 'pinned')
    .map(({ identifier }) => identifier);
  return {
    missingSkillBinding: !activePlugins.includes(template.skillSlots[0]),
    missingSkillIdentifier: !skillExists,
    missingTools: template.plugins.filter((identifier) => !activePlugins.includes(identifier)),
  };
};

type TravelGroupSupervisorDiagnosticCandidate = {
  agencyConfig: (typeof agents.$inferSelect)['agencyConfig'];
  enabled: boolean | null;
  slug: string | null;
  title: string | null;
};

const getTravelGroupSupervisorDiagnostic = (
  supervisors: TravelGroupSupervisorDiagnosticCandidate[],
  expectedTitle = DEFAULT_TRAVEL_GROUP_SUPERVISOR_TITLE,
): {
  issueCodes: DefaultTravelServiceGroupHealthIssueCode[];
  supervisor: DefaultTravelServiceGroupHealthSummary['supervisor'];
} => {
  const identityMatches = supervisors.length === 1 && supervisors[0].slug === GROUP_SUPERVISOR.slug;
  const legacyInbox = supervisors.length === 1 && supervisors[0].slug === INBOX.slug;
  const supervisor = {
    count: supervisors.length,
    platformManaged: identityMatches && isPlatformManagedAgent(supervisors[0].agencyConfig),
    titleMatches: identityMatches && supervisors[0].title === expectedTitle,
  };
  const issueCodes: DefaultTravelServiceGroupHealthIssueCode[] = [];

  if (supervisor.count !== 1) {
    issueCodes.push('SUPERVISOR_COUNT_INVALID');
  } else if (legacyInbox) {
    issueCodes.push('LEGACY_INBOX_SUPERVISOR');
  } else if (!identityMatches) {
    issueCodes.push('SUPERVISOR_IDENTITY_INVALID');
  } else {
    if (supervisors[0].enabled !== true) issueCodes.push('SUPERVISOR_DISABLED');
    if (!supervisor.titleMatches) issueCodes.push('SUPERVISOR_TITLE_INVALID');
    if (!supervisor.platformManaged) issueCodes.push('SUPERVISOR_NOT_PLATFORM_MANAGED');
  }

  return { issueCodes, supervisor };
};

/**
 * Read-only diagnostic seam for a platform administrator module.
 *
 * This function performs no authorization. Callers must enforce the active,
 * unbanned platform-administrator guard before supplying a target user. Its
 * return type intentionally contains only booleans, counts and fixed issue
 * codes; it never exposes user PII or agent prompt/model/provider/key details.
 */
export const getDefaultTravelServiceGroupHealthSummary = async (
  db: LobeChatDatabase,
  { targetUserId, workspaceId }: DefaultTravelServiceGroupHealthTarget,
): Promise<DefaultTravelServiceGroupHealthSummary> => {
  const expectedWorkspaceId = workspaceId ?? null;
  const ownedDefaultGroups = await db
    .select({
      content: chatGroups.content,
      id: chatGroups.id,
      visibility: chatGroups.visibility,
      workspaceId: chatGroups.workspaceId,
    })
    .from(chatGroups)
    .where(
      and(
        eq(chatGroups.userId, targetUserId),
        eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
      ),
    );
  const groups = ownedDefaultGroups.filter(({ workspaceId: actualWorkspaceId }) =>
    expectedWorkspaceId === null
      ? actualWorkspaceId === null
      : actualWorkspaceId === expectedWorkspaceId,
  );
  let scopeInvalid = ownedDefaultGroups.some(
    ({ workspaceId: actualWorkspaceId }) => actualWorkspaceId !== expectedWorkspaceId,
  );
  const ownedManagedIdentities = await db
    .select({ workspaceId: agents.workspaceId })
    .from(agents)
    .where(
      and(
        eq(agents.userId, targetUserId),
        or(
          eq(agents.slug, GROUP_SUPERVISOR.slug),
          like(agents.clientId, 'supergroup-template-%'),
          inArray(
            agents.clientId,
            TRAVEL_SPECIALIST_TEMPLATES.map(({ clientId }) => clientId),
          ),
        ),
      ),
    );
  scopeInvalid ||= ownedManagedIdentities.some(
    ({ workspaceId: actualWorkspaceId }) => actualWorkspaceId !== expectedWorkspaceId,
  );

  const requiredMembers: DefaultTravelServiceGroupHealthSummary['requiredMembers'] = {
    'copywriter': { enabled: false, exists: false, platformManaged: false },
    'designer': { enabled: false, exists: false, platformManaged: false },
    'document-assistant': { enabled: false, exists: false, platformManaged: false },
    'video-producer': { enabled: false, exists: false, platformManaged: false },
  };
  const emptySupervisor = { count: 0, platformManaged: false, titleMatches: false };

  if (groups.length === 0) {
    return {
      groupCount: 0,
      healthy: false,
      isPrivate: false,
      issueCodes: scopeInvalid
        ? ['DEFAULT_GROUP_MISSING', 'DEFAULT_GROUP_SCOPE_INVALID']
        : ['DEFAULT_GROUP_MISSING'],
      requiredMembers,
      supervisor: emptySupervisor,
    };
  }

  const skillModel = new AgentSkillModel(db, targetUserId, workspaceId ?? undefined);
  const skills = await Promise.all(
    TRAVEL_SPECIALIST_TEMPLATES.map(({ skillSlots }) => skillModel.findByIdentifier(skillSlots[0])),
  );

  const roster = await db
    .select({
      agencyConfig: agents.agencyConfig,
      avatar: agents.avatar,
      backgroundColor: agents.backgroundColor,
      agentUserId: agents.userId,
      agentWorkspaceId: agents.workspaceId,
      clientId: agents.clientId,
      description: agents.description,
      enabled: chatGroupsAgents.enabled,
      model: agents.model,
      params: agents.params,
      plugins: agents.plugins,
      provider: agents.provider,
      relationUserId: chatGroupsAgents.userId,
      relationWorkspaceId: chatGroupsAgents.workspaceId,
      role: chatGroupsAgents.role,
      slug: agents.slug,
      systemRole: agents.systemRole,
      title: agents.title,
      name: agents.name,
    })
    .from(chatGroupsAgents)
    .innerJoin(agents, eq(agents.id, chatGroupsAgents.agentId))
    .where(
      inArray(
        chatGroupsAgents.chatGroupId,
        groups.map(({ id }) => id),
      ),
    );

  scopeInvalid ||= roster.some(
    ({ agentUserId, agentWorkspaceId, relationUserId, relationWorkspaceId }) =>
      agentUserId !== targetUserId ||
      relationUserId !== targetUserId ||
      agentWorkspaceId !== expectedWorkspaceId ||
      relationWorkspaceId !== expectedWorkspaceId,
  );

  const supervisors = roster.filter(({ role }) => role === 'supervisor');
  const publishedTemplate = await getSuperGroupTemplate(db);
  const supervisorDiagnostic = getTravelGroupSupervisorDiagnostic(
    supervisors,
    publishedTemplate.supervisor?.title,
  );

  for (const template of TRAVEL_SPECIALIST_TEMPLATES) {
    const members = roster.filter(
      ({ clientId, role }) => clientId === template.clientId && role !== 'supervisor',
    );
    requiredMembers[template.key] = {
      enabled: members.length === 1 && members[0].enabled === true,
      exists: members.length > 0,
      platformManaged: members.length === 1 && isPlatformManagedAgent(members[0].agencyConfig),
    };
  }

  const issueCodes: DefaultTravelServiceGroupHealthIssueCode[] = [];
  if (groups.length > 1) issueCodes.push('DEFAULT_GROUP_DUPLICATED');
  const isPrivate = groups.every(({ visibility }) => visibility === 'private');
  if (!isPrivate) issueCodes.push('DEFAULT_GROUP_NOT_PRIVATE');
  if (
    groups.some(({ content }) => !content?.trim() || content === LEGACY_TRAVEL_GROUP_SYSTEM_PROMPT)
  ) {
    issueCodes.push('DEFAULT_GROUP_INSTRUCTIONS_MISSING');
  }
  if (scopeInvalid) issueCodes.push('DEFAULT_GROUP_SCOPE_INVALID');
  issueCodes.push(...supervisorDiagnostic.issueCodes);

  const memberIssueCodes: Record<
    DefaultTravelServiceGroupRequiredMemberKey,
    {
      disabled: DefaultTravelServiceGroupHealthIssueCode;
      duplicated: DefaultTravelServiceGroupHealthIssueCode;
      missing: DefaultTravelServiceGroupHealthIssueCode;
      notPlatformManaged: DefaultTravelServiceGroupHealthIssueCode;
    }
  > = {
    'copywriter': {
      disabled: 'COPYWRITER_DISABLED',
      duplicated: 'COPYWRITER_DUPLICATED',
      missing: 'COPYWRITER_MISSING',
      notPlatformManaged: 'COPYWRITER_NOT_PLATFORM_MANAGED',
    },
    'designer': {
      disabled: 'DESIGNER_DISABLED',
      duplicated: 'DESIGNER_DUPLICATED',
      missing: 'DESIGNER_MISSING',
      notPlatformManaged: 'DESIGNER_NOT_PLATFORM_MANAGED',
    },
    'document-assistant': {
      disabled: 'DOCUMENT_ASSISTANT_DISABLED',
      duplicated: 'DOCUMENT_ASSISTANT_DUPLICATED',
      missing: 'DOCUMENT_ASSISTANT_MISSING',
      notPlatformManaged: 'DOCUMENT_ASSISTANT_NOT_PLATFORM_MANAGED',
    },
    'video-producer': {
      disabled: 'VIDEO_PRODUCER_DISABLED',
      duplicated: 'VIDEO_PRODUCER_DUPLICATED',
      missing: 'VIDEO_PRODUCER_MISSING',
      notPlatformManaged: 'VIDEO_PRODUCER_NOT_PLATFORM_MANAGED',
    },
  };
  const memberBindingIssueCodes: Record<
    DefaultTravelServiceGroupRequiredMemberKey,
    {
      skill: DefaultTravelServiceGroupHealthIssueCode;
      tool: DefaultTravelServiceGroupHealthIssueCode;
    }
  > = {
    'copywriter': {
      skill: 'COPYWRITER_SKILL_BINDING_MISSING',
      tool: 'COPYWRITER_TOOL_BINDING_MISSING',
    },
    'designer': {
      skill: 'DESIGNER_SKILL_BINDING_MISSING',
      tool: 'DESIGNER_TOOL_BINDING_MISSING',
    },
    'document-assistant': {
      skill: 'DOCUMENT_ASSISTANT_SKILL_BINDING_MISSING',
      tool: 'DOCUMENT_ASSISTANT_TOOL_BINDING_MISSING',
    },
    'video-producer': {
      skill: 'VIDEO_PRODUCER_SKILL_BINDING_MISSING',
      tool: 'VIDEO_PRODUCER_TOOL_BINDING_MISSING',
    },
  };
  const memberTemplateIssueCodes: Record<
    DefaultTravelServiceGroupRequiredMemberKey,
    DefaultTravelServiceGroupHealthIssueCode
  > = {
    'copywriter': 'COPYWRITER_TEMPLATE_MISMATCH',
    'designer': 'DESIGNER_TEMPLATE_MISMATCH',
    'document-assistant': 'DOCUMENT_ASSISTANT_TEMPLATE_MISMATCH',
    'video-producer': 'VIDEO_PRODUCER_TEMPLATE_MISMATCH',
  };
  for (const [index, template] of TRAVEL_SPECIALIST_TEMPLATES.entries()) {
    if (publishedTemplate.revision > 0) continue;
    const status = requiredMembers[template.key];
    const codes = memberIssueCodes[template.key];
    const members = roster.filter(
      ({ clientId, role }) => clientId === template.clientId && role !== 'supervisor',
    );
    const memberCount = members.length;
    if (memberCount > 1) {
      issueCodes.push(codes.duplicated);
      continue;
    }
    if (!status.exists) {
      issueCodes.push(codes.missing);
      continue;
    }
    if (!status.enabled) issueCodes.push(codes.disabled);
    if (!status.platformManaged) issueCodes.push(codes.notPlatformManaged);
    const publishedMember = publishedTemplate.members.find(({ key }) => key === template.key);
    if (
      members[0].title !== (publishedMember?.title ?? template.label) ||
      members[0].systemRole !== (publishedMember?.systemRole ?? template.systemRole)
    ) {
      issueCodes.push(memberTemplateIssueCodes[template.key]);
    }
    const plugins = Array.isArray(members[0].plugins) ? members[0].plugins : [];
    const bindingCodes = memberBindingIssueCodes[template.key];
    const bindingDiagnostic = getRequiredMemberBindingDiagnostic(
      template,
      plugins,
      Boolean(skills[index]),
    );
    if (bindingDiagnostic.missingSkillBinding || bindingDiagnostic.missingSkillIdentifier) {
      issueCodes.push(bindingCodes.skill);
    }
    if (bindingDiagnostic.missingTools.length > 0) issueCodes.push(bindingCodes.tool);
  }

  const builtinKeys = new Set<string>(TRAVEL_SPECIALIST_TEMPLATES.map(({ key }) => key));
  const customTemplateMembers = publishedTemplate.members.filter(
    ({ key }) => publishedTemplate.revision > 0 || !builtinKeys.has(key),
  );
  const expectedCustomClientIds = new Set<string>(
    customTemplateMembers.map(({ key }) => getSuperGroupTemplateMemberClientId(key)),
  );
  let publishedTemplateOutOfSync = false;
  let publishedTemplateNeedsReview = false;
  for (const member of customTemplateMembers) {
    const memberClientId = getSuperGroupTemplateMemberClientId(member.key);
    const matchingMembers = roster.filter(
      ({ clientId, role }) => clientId === memberClientId && role !== 'supervisor',
    );
    if (matchingMembers.length > 1) {
      publishedTemplateNeedsReview = true;
      continue;
    }
    if (
      matchingMembers.length === 0 ||
      matchingMembers[0].enabled !== true ||
      !matchesPublishedTemplateMember(matchingMembers[0], member)
    ) {
      publishedTemplateOutOfSync = true;
    }
  }
  if (
    roster.some(
      ({ clientId }) =>
        clientId?.startsWith('supergroup-template-') && !expectedCustomClientIds.has(clientId),
    )
  ) {
    publishedTemplateNeedsReview = true;
  }
  if (publishedTemplateNeedsReview) {
    issueCodes.push('PUBLISHED_TEMPLATE_MEMBERS_REVIEW_REQUIRED');
  } else if (publishedTemplateOutOfSync) {
    issueCodes.push('PUBLISHED_TEMPLATE_MEMBERS_OUT_OF_SYNC');
  }

  return {
    groupCount: groups.length,
    healthy: issueCodes.length === 0,
    isPrivate,
    issueCodes,
    requiredMembers,
    supervisor: supervisorDiagnostic.supervisor,
  };
};

export type TravelServiceGroupAccessState =
  'active' | 'banned' | 'email-unverified' | 'missing-user';

const getTravelServiceGroupAccessState = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<TravelServiceGroupAccessState> => {
  const user = await db.query.users.findFirst({
    columns: { banExpires: true, banned: true, emailVerified: true },
    where: eq(users.id, userId),
  });
  if (!user) return 'missing-user';
  if (authEnv.AUTH_EMAIL_VERIFICATION && !user.emailVerified) return 'email-unverified';

  const activeBan =
    user.banned === true && (!user.banExpires || new Date(user.banExpires).getTime() > Date.now());
  return activeBan ? 'banned' : 'active';
};

const mergeDefaultTravelMemberSlots = (
  requiredSlots: NonNullable<ChatGroupConfig['memberSlots']>,
  existingSlots: ChatGroupConfig['memberSlots'],
): NonNullable<ChatGroupConfig['memberSlots']> => {
  if (!existingSlots) return requiredSlots;

  const existingByKey = new Map(existingSlots.map((slot) => [slot.key, slot]));
  const requiredKeys = new Set(requiredSlots.map(({ key }) => key));
  return [
    ...requiredSlots.map((required) => {
      const existing = existingByKey.get(required.key);
      if (!existing) return required;
      return {
        ...required,
        ...existing,
        agentId: required.agentId,
        configurable: required.configurable,
        key: required.key,
        label: required.label,
        role: required.role,
        skillSlots: required.skillSlots,
        status: required.status,
      };
    }),
    ...existingSlots.filter(({ key }) => !requiredKeys.has(key)),
  ];
};

const initDefaultTravelServiceGroupInTransaction = async (db: LobeChatDatabase, userId: string) => {
  if ((await getTravelServiceGroupAccessState(db, userId)) !== 'active') return null;

  const groupModel = new ChatGroupModel(db, userId);
  const agentModel = new AgentModel(db, userId);
  const skillModel = new AgentSkillModel(db, userId);

  // A published roster replaces the bootstrap defaults, including an empty roster.
  const publishedTemplate = await getSuperGroupTemplate(db);
  const bootstrapTemplates = publishedTemplate.revision > 0 ? [] : TRAVEL_SPECIALIST_TEMPLATES;

  const [supervisor, legacyInbox] = await Promise.all([
    agentModel.getBuiltinAgent(GROUP_SUPERVISOR.slug),
    agentModel.getBuiltinAgent(INBOX.slug),
  ]);
  if (!supervisor) {
    throw new Error('Travel service group built-in supervisor agent is unavailable');
  }
  await agentModel.updateConfig(supervisor.id, {
    avatar: DEFAULT_INBOX_AVATAR,
    title: DEFAULT_TRAVEL_GROUP_SUPERVISOR_TITLE,
    ...(!supervisor.description?.trim()
      ? { description: TRAVEL_GROUP_SUPERVISOR_DESCRIPTION }
      : {}),
  });
  await agentModel.ensurePlatformManagedModelRuntime(supervisor.id);

  const skills = await Promise.all(
    bootstrapTemplates.map(({ description, label, skillContent, skillSlots }) =>
      skillModel.ensureByIdentifier({
        content: skillContent,
        description,
        identifier: skillSlots[0],
        manifest: { description, name: label, version: '1.0.0' },
        name: label,
        source: 'builtin',
      }),
    ),
  );
  const specialists = await Promise.all(
    bootstrapTemplates.map(({ clientId, description, label, plugins, systemRole }, index) =>
      agentModel.ensureByClientId(clientId, {
        agencyConfig: {
          modelRuntimeMode: 'platform-managed',
          modelSelectionPolicy: 'fixed',
        },
        description,
        plugins: [...(plugins ? [...plugins] : []), skills[index].identifier],
        systemRole,
        title: label,
        virtual: true,
      }),
    ),
  );
  await Promise.all(
    specialists.map((specialist, index) => {
      const clientId = bootstrapTemplates[index].clientId;
      const plugins = Array.isArray(specialist.plugins) ? specialist.plugins : [];
      const obsoletePlugin =
        clientId === 'default-travel-image-designer'
          ? 'lobe-image-generation'
          : clientId === 'default-travel-document-assistant'
            ? 'lobe-artifacts'
            : undefined;
      const patch = {
        ...(!specialist.description?.trim()
          ? { description: bootstrapTemplates[index].description }
          : {}),
        ...(obsoletePlugin && plugins.includes(obsoletePlugin)
          ? { plugins: plugins.filter((identifier) => identifier !== obsoletePlugin) }
          : {}),
      };
      if (Object.keys(patch).length === 0) return;
      return agentModel.updateConfig(specialist.id, patch);
    }),
  );
  // updateConfig deliberately strips the server-only runtime marker from any
  // client-shaped patch. Obsolete plugin cleanup above uses that safe path, so
  // restore the trusted runtime only after all such patches have completed.
  await Promise.all(specialists.map(({ id }) => agentModel.ensurePlatformManagedModelRuntime(id)));

  const requiredMemberSlots: NonNullable<ChatGroupConfig['memberSlots']> = [
    {
      agentId: supervisor.id,
      configurable: false,
      key: 'travel-owner',
      label: '旅游群主AI',
      role: 'supervisor',
      skillSlots: ['tourism-service-orchestration'],
      status: 'configured',
    },
    ...bootstrapTemplates.map((slot, index) => ({
      agentId: specialists[index].id,
      configurable: false,
      key: slot.key,
      label: slot.label,
      role: 'participant' as const,
      skillSlots: [...slot.skillSlots],
      status: 'configured' as const,
    })),
  ];
  const existingGroup = await groupModel.findByClientId(DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID);
  const group = await groupModel.ensureByClientId({
    clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
    config: {
      memberSlots: mergeDefaultTravelMemberSlots(
        requiredMemberSlots,
        existingGroup?.config?.memberSlots,
      ),
    },
    content: DEFAULT_TRAVEL_GROUP_SYSTEM_PROMPT,
    description: '用于统筹旅游服务内容与制作协作的专属AI群组',
    pinned: true,
    title: '旅游服务超级群组',
    visibility: 'private',
  });
  if (!group.content?.trim())
    await groupModel.ensureContentIfBlank(group.id, DEFAULT_TRAVEL_GROUP_SYSTEM_PROMPT);
  else if (group.content === LEGACY_TRAVEL_GROUP_SYSTEM_PROMPT)
    await groupModel.update(group.id, { content: DEFAULT_TRAVEL_GROUP_SYSTEM_PROMPT });
  if (group.visibility !== 'private') await groupModel.setVisibility(group.id, 'private');

  const legacySupervisors = (await groupModel.getGroupAgents(group.id)).filter(
    ({ agentId, role }) => role === 'supervisor' && agentId === legacyInbox?.id,
  );
  const legacyInboxWasSupervisor = legacySupervisors.some(
    ({ agentId }) => agentId === legacyInbox?.id,
  );
  await groupModel.ensureSupervisorAgent(group.id, supervisor.id);

  // Older bootstraps reused the personal Inbox as the travel group supervisor.
  // Once the dedicated supervisor is attached, remove the internal platform
  // credential marker so ordinary Inbox chat returns to the user's own model
  // selection instead of silently spending the platform account.
  if (
    legacyInbox &&
    legacyInbox.id !== supervisor.id &&
    legacyInboxWasSupervisor &&
    legacyInbox.agencyConfig?.modelRuntimeMode === 'platform-managed'
  ) {
    await agentModel.updateConfig(legacyInbox.id, {
      agencyConfig: { modelSelectionPolicy: 'member' },
    });
  }
  // Remove legacy memberships only after the Inbox policy is restored. If that
  // write fails, the old relationship remains as a durable retry marker for the
  // next idempotent bootstrap instead of leaving a permanently undetectable Inbox.
  await Promise.all(
    legacySupervisors.map(({ agentId }) => groupModel.removeAgentFromGroup(group.id, agentId)),
  );
  await groupModel.ensureParticipantAgents(
    group.id,
    specialists.map(({ id }) => id),
  );

  return (await applySuperGroupTemplate(db, group.id, userId)) ?? group;
};

const sameRepairPlan = (
  left: DefaultTravelServiceGroupRepairPlan,
  right: DefaultTravelServiceGroupRepairPlan,
) =>
  left.reviewRequired === right.reviewRequired &&
  left.actions.length === right.actions.length &&
  left.actions.every((action, index) => {
    const other = right.actions[index];
    return (
      action.code === other?.code &&
      action.reviewRequired === other.reviewRequired &&
      action.target === other.target
    );
  });

const assertDefaultTravelServiceGroupRepairScope = async (
  db: LobeChatDatabase,
  { targetUserId, workspaceId }: DefaultTravelServiceGroupHealthTarget,
) => {
  const expectedWorkspaceId = workspaceId ?? null;
  const ownedGroups = await db
    .select({ id: chatGroups.id, workspaceId: chatGroups.workspaceId })
    .from(chatGroups)
    .where(
      and(
        eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
        eq(chatGroups.userId, targetUserId),
      ),
    );
  if (ownedGroups.some((group) => group.workspaceId !== expectedWorkspaceId)) {
    throw new Error(TRAVEL_GROUP_REPAIR_SCOPE_INVALID);
  }

  const managedIdentities = await db
    .select({ workspaceId: agents.workspaceId })
    .from(agents)
    .where(
      and(
        eq(agents.userId, targetUserId),
        or(
          eq(agents.slug, GROUP_SUPERVISOR.slug),
          like(agents.clientId, 'supergroup-template-%'),
          inArray(
            agents.clientId,
            TRAVEL_SPECIALIST_TEMPLATES.map(({ clientId }) => clientId),
          ),
        ),
      ),
    );
  if (managedIdentities.some((agent) => agent.workspaceId !== expectedWorkspaceId)) {
    throw new Error(TRAVEL_GROUP_REPAIR_SCOPE_INVALID);
  }
  if (ownedGroups.length === 0) return;

  const roster = await db
    .select({
      agentUserId: agents.userId,
      agentWorkspaceId: agents.workspaceId,
      groupUserId: chatGroups.userId,
      groupWorkspaceId: chatGroups.workspaceId,
      relationUserId: chatGroupsAgents.userId,
      relationWorkspaceId: chatGroupsAgents.workspaceId,
    })
    .from(chatGroupsAgents)
    .innerJoin(chatGroups, eq(chatGroups.id, chatGroupsAgents.chatGroupId))
    .innerJoin(agents, eq(agents.id, chatGroupsAgents.agentId))
    .where(
      inArray(
        chatGroupsAgents.chatGroupId,
        ownedGroups.map(({ id }) => id),
      ),
    );
  if (
    roster.some(
      (row) =>
        row.groupUserId !== targetUserId ||
        row.relationUserId !== targetUserId ||
        row.agentUserId !== targetUserId ||
        row.groupWorkspaceId !== expectedWorkspaceId ||
        row.relationWorkspaceId !== expectedWorkspaceId ||
        row.agentWorkspaceId !== expectedWorkspaceId,
    )
  ) {
    throw new Error(TRAVEL_GROUP_REPAIR_SCOPE_INVALID);
  }
};

const getOwnedDefaultTravelServiceGroupId = async (
  db: LobeChatDatabase,
  { targetUserId, workspaceId }: DefaultTravelServiceGroupHealthTarget,
) => {
  const groups = await db
    .select({ id: chatGroups.id })
    .from(chatGroups)
    .where(
      and(
        eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
        eq(chatGroups.userId, targetUserId),
        workspaceId == null
          ? isNull(chatGroups.workspaceId)
          : eq(chatGroups.workspaceId, workspaceId),
      ),
    );
  if (groups.length !== 1) throw new Error(TRAVEL_GROUP_REPAIR_STATE_CHANGED);
  return groups[0].id;
};

const getRepairTargetAgentId = async (
  db: LobeChatDatabase,
  groupId: string,
  target: DefaultTravelServiceGroupRepairTarget,
) => {
  const template = TRAVEL_SPECIALIST_TEMPLATES.find(({ key }) => key === target);
  const rows = await db
    .select({ id: agents.id })
    .from(chatGroupsAgents)
    .innerJoin(agents, eq(agents.id, chatGroupsAgents.agentId))
    .where(
      and(
        eq(chatGroupsAgents.chatGroupId, groupId),
        template
          ? and(eq(agents.clientId, template.clientId), ne(chatGroupsAgents.role, 'supervisor'))
          : eq(chatGroupsAgents.role, 'supervisor'),
      ),
    );
  if (rows.length !== 1) throw new Error(TRAVEL_GROUP_REPAIR_STATE_CHANGED);
  return rows[0].id;
};

const ensureRequiredTravelServiceMember = async (
  db: LobeChatDatabase,
  target: DefaultTravelServiceGroupRepairTarget,
  targetUserId: string,
  workspaceId: string | undefined,
  groupId: string,
) => {
  const template = TRAVEL_SPECIALIST_TEMPLATES.find(({ key }) => key === target);
  if (!template) throw new Error(TRAVEL_GROUP_REPAIR_STATE_CHANGED);
  const agentModel = new AgentModel(db, targetUserId, workspaceId);
  const skillModel = new AgentSkillModel(db, targetUserId, workspaceId);
  const groupModel = new ChatGroupModel(db, targetUserId, workspaceId);
  const skill = await skillModel.ensureByIdentifier({
    content: template.skillContent,
    description: template.description,
    identifier: template.skillSlots[0],
    manifest: { description: template.description, name: template.label, version: '1.0.0' },
    name: template.label,
    source: 'builtin',
  });
  const specialist = await agentModel.ensureByClientId(template.clientId, {
    agencyConfig: { modelRuntimeMode: 'platform-managed', modelSelectionPolicy: 'fixed' },
    plugins: [...template.plugins, skill.identifier],
    systemRole: template.systemRole,
    title: template.label,
    virtual: true,
  });
  await agentModel.ensurePlatformManagedModelRuntime(specialist.id);
  await groupModel.ensureParticipantAgents(groupId, [specialist.id]);
  if (!workspaceId) await applySuperGroupTemplate(db, groupId, targetUserId);
};

const applyDefaultTravelServiceGroupRepairAction = async (
  db: LobeChatDatabase,
  action: DefaultTravelServiceGroupRepairAction,
  target: DefaultTravelServiceGroupHealthTarget,
) => {
  const workspaceId = target.workspaceId ?? undefined;
  if (action.code === 'CREATE_DEFAULT_GROUP') {
    if (workspaceId) throw new Error(TRAVEL_GROUP_REPAIR_SCOPE_INVALID);
    if (!(await initDefaultTravelServiceGroupInTransaction(db, target.targetUserId))) {
      throw new Error(TRAVEL_GROUP_REPAIR_EXECUTION_FAILED);
    }
    return;
  }

  const groupId = await getOwnedDefaultTravelServiceGroupId(db, target);
  const groupModel = new ChatGroupModel(db, target.targetUserId, workspaceId);
  const agentModel = new AgentModel(db, target.targetUserId, workspaceId);

  switch (action.code) {
    case 'SET_PRIVATE': {
      if (!(await groupModel.setVisibility(groupId, 'private'))) {
        throw new Error(TRAVEL_GROUP_REPAIR_EXECUTION_FAILED);
      }
      return;
    }
    case 'ENSURE_GROUP_INSTRUCTIONS': {
      let group = await groupModel.ensureContentIfBlank(
        groupId,
        DEFAULT_TRAVEL_GROUP_SYSTEM_PROMPT,
      );
      if (group.content === LEGACY_TRAVEL_GROUP_SYSTEM_PROMPT)
        group = await groupModel.update(groupId, { content: DEFAULT_TRAVEL_GROUP_SYSTEM_PROMPT });
      // The readiness repair path does not run onboarding. Backfill only blank,
      // public introductions; never replace an administrator's published profile.
      await Promise.all(
        [
          {
            condition: eq(agents.slug, GROUP_SUPERVISOR.slug),
            description: TRAVEL_GROUP_SUPERVISOR_DESCRIPTION,
          },
          ...TRAVEL_SPECIALIST_TEMPLATES.map(({ clientId, description }) => ({
            condition: eq(agents.clientId, clientId),
            description,
          })),
        ].map(({ condition, description }) =>
          db
            .update(agents)
            .set({ description })
            .where(
              and(
                eq(agents.userId, target.targetUserId),
                isNull(agents.workspaceId),
                condition,
                sql`nullif(trim(${agents.description}), '') IS NULL`,
              ),
            ),
        ),
      );
      if (!group.content?.trim()) throw new Error(TRAVEL_GROUP_REPAIR_EXECUTION_FAILED);
      return;
    }
    case 'ENSURE_SUPERVISOR': {
      const supervisor = await agentModel.getBuiltinAgent(GROUP_SUPERVISOR.slug);
      if (!supervisor) throw new Error(TRAVEL_GROUP_REPAIR_EXECUTION_FAILED);
      await agentModel.updateConfig(supervisor.id, {
        title: DEFAULT_TRAVEL_GROUP_SUPERVISOR_TITLE,
      });
      await agentModel.ensurePlatformManagedModelRuntime(supervisor.id);
      await groupModel.ensureSupervisorAgent(groupId, supervisor.id);
      return;
    }
    case 'MIGRATE_LEGACY_INBOX_SUPERVISOR': {
      const legacyAgentId = await getRepairTargetAgentId(db, groupId, 'supervisor');
      const legacyInbox = await agentModel.getAgentConfigById(legacyAgentId);
      if (legacyInbox?.slug !== INBOX.slug) throw new Error(TRAVEL_GROUP_REPAIR_STATE_CHANGED);

      const supervisor = await agentModel.getBuiltinAgent(GROUP_SUPERVISOR.slug);
      if (!supervisor) throw new Error(TRAVEL_GROUP_REPAIR_EXECUTION_FAILED);
      await agentModel.updateConfig(supervisor.id, {
        title: DEFAULT_TRAVEL_GROUP_SUPERVISOR_TITLE,
      });
      await agentModel.ensurePlatformManagedModelRuntime(supervisor.id);
      await groupModel.ensureSupervisorAgent(groupId, supervisor.id);
      if (legacyInbox.agencyConfig?.modelRuntimeMode === 'platform-managed') {
        await agentModel.updateConfig(legacyAgentId, {
          agencyConfig: { modelSelectionPolicy: 'member' },
        });
      }
      await groupModel.removeAgentFromGroup(groupId, legacyAgentId);
      return;
    }
    case 'RENAME_SUPERVISOR': {
      const agentId = await getRepairTargetAgentId(db, groupId, action.target);
      const renamed = await db
        .update(agents)
        .set({ title: DEFAULT_TRAVEL_GROUP_SUPERVISOR_TITLE, updatedAt: new Date() })
        .where(
          and(
            eq(agents.id, agentId),
            eq(agents.userId, target.targetUserId),
            workspaceId ? eq(agents.workspaceId, workspaceId) : isNull(agents.workspaceId),
          ),
        )
        .returning({ id: agents.id });
      if (renamed.length !== 1) throw new Error(TRAVEL_GROUP_REPAIR_SCOPE_INVALID);
      return;
    }
    case 'MARK_PLATFORM_MANAGED': {
      const agentId = await getRepairTargetAgentId(db, groupId, action.target);
      await agentModel.ensurePlatformManagedModelRuntime(agentId);
      return;
    }
    case 'ENSURE_REQUIRED_MEMBER': {
      await ensureRequiredTravelServiceMember(
        db,
        action.target,
        target.targetUserId,
        workspaceId,
        groupId,
      );
      return;
    }
    case 'ENABLE_REQUIRED_MEMBER': {
      const agentId = await getRepairTargetAgentId(db, groupId, action.target);
      await groupModel.ensureParticipantAgents(groupId, [agentId]);
      return;
    }
    case 'APPLY_PUBLISHED_TEMPLATE': {
      if (workspaceId) throw new Error(TRAVEL_GROUP_REPAIR_SCOPE_INVALID);
      await applySuperGroupTemplate(db, groupId, target.targetUserId);
      return;
    }
    default: {
      throw new Error(TRAVEL_GROUP_REPAIR_ACTION_NOT_ALLOWED);
    }
  }
};

const countExecutedRepairActions = (actions: DefaultTravelServiceGroupRepairAction[]) => {
  const counts = new Map<SafeDefaultTravelServiceGroupRepairActionCode, number>();
  for (const action of actions) {
    const code = action.code as SafeDefaultTravelServiceGroupRepairActionCode;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts].map(([code, count]) => ({ code, count }));
};

/**
 * Applies only a previously previewed safe repair plan. This service performs
 * no administrator authorization; callers must use it behind the active,
 * unbanned platform-admin guard. Every write is ownership/workspace scoped and
 * transactional, and the final health summary is the only state returned.
 */
export const executeDefaultTravelServiceGroupRepairPlan = async (
  db: LobeChatDatabase,
  { expectedPlan, targetUserId, workspaceId }: ExecuteDefaultTravelServiceGroupRepairPlanInput,
): Promise<ExecuteDefaultTravelServiceGroupRepairPlanResult> => {
  if (
    expectedPlan.reviewRequired ||
    expectedPlan.actions.some(({ reviewRequired }) => reviewRequired)
  ) {
    throw new Error(TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED);
  }
  const allowedCodes = new Set<string>(SAFE_DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES);
  if (expectedPlan.actions.some(({ code }) => !allowedCodes.has(code))) {
    throw new Error(TRAVEL_GROUP_REPAIR_ACTION_NOT_ALLOWED);
  }

  const target = { targetUserId, workspaceId };
  try {
    return await db.transaction(async (transaction) => {
      const tx = transaction as LobeChatDatabase;
      if ((await getTravelServiceGroupAccessState(tx, targetUserId)) !== 'active') {
        throw new Error(TRAVEL_GROUP_REPAIR_SCOPE_INVALID);
      }
      await assertDefaultTravelServiceGroupRepairScope(tx, target);

      for (let index = 0; index < expectedPlan.actions.length; index += 1) {
        if ((await getTravelServiceGroupAccessState(tx, targetUserId)) !== 'active') {
          throw new Error(TRAVEL_GROUP_REPAIR_SCOPE_INVALID);
        }
        const remainingPlan: DefaultTravelServiceGroupRepairPlan = {
          actions: expectedPlan.actions.slice(index),
          reviewRequired: false,
        };
        const currentHealth = await getDefaultTravelServiceGroupHealthSummary(tx, target);
        const currentPlan = buildDefaultTravelServiceGroupRepairPlan(currentHealth);
        if (!sameRepairPlan(currentPlan, remainingPlan)) {
          throw new Error(TRAVEL_GROUP_REPAIR_STATE_CHANGED);
        }
        await assertDefaultTravelServiceGroupRepairScope(tx, target);
        await applyDefaultTravelServiceGroupRepairAction(tx, expectedPlan.actions[index], target);
      }

      if ((await getTravelServiceGroupAccessState(tx, targetUserId)) !== 'active') {
        throw new Error(TRAVEL_GROUP_REPAIR_SCOPE_INVALID);
      }
      await assertDefaultTravelServiceGroupRepairScope(tx, target);
      const finalHealth = await getDefaultTravelServiceGroupHealthSummary(tx, target);
      if (!finalHealth.healthy || finalHealth.issueCodes.length > 0) {
        throw new Error(TRAVEL_GROUP_REPAIR_STATE_CHANGED);
      }
      return {
        actionCounts: countExecutedRepairActions(expectedPlan.actions),
        finalHealth,
      };
    });
  } catch (error) {
    if (
      error instanceof Error &&
      [
        TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED,
        TRAVEL_GROUP_REPAIR_ACTION_NOT_ALLOWED,
        TRAVEL_GROUP_REPAIR_STATE_CHANGED,
        TRAVEL_GROUP_REPAIR_SCOPE_INVALID,
      ].includes(error.message)
    ) {
      throw error;
    }
  }
  // Keep unexpected database/provider errors behind one fixed public code;
  // their messages can contain implementation or tenant details.
  throw new Error(TRAVEL_GROUP_REPAIR_EXECUTION_FAILED);
};

export const initDefaultTravelServiceGroup = async (db: LobeChatDatabase, userId: string) =>
  db.transaction(async (tx) => {
    await lockSuperGroupTemplate(tx as LobeChatDatabase);
    return initDefaultTravelServiceGroupInTransaction(tx as LobeChatDatabase, userId);
  });

/** Upgrade only missing/default metadata on an existing owned group; never run onboarding. */
export const backfillDefaultTravelGroupSupervisorProfile = async (
  db: LobeChatDatabase,
  userId: string,
  groupId: string,
): Promise<boolean> => {
  if ((await getTravelServiceGroupAccessState(db, userId)) !== 'active') return false;
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        agentId: agents.id,
        content: chatGroups.content,
        description: agents.description,
      })
      .from(chatGroups)
      .innerJoin(chatGroupsAgents, eq(chatGroupsAgents.chatGroupId, chatGroups.id))
      .innerJoin(agents, eq(agents.id, chatGroupsAgents.agentId))
      .where(
        and(
          eq(chatGroups.id, groupId),
          eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
          eq(chatGroups.userId, userId),
          isNull(chatGroups.workspaceId),
          eq(chatGroupsAgents.role, 'supervisor'),
          eq(chatGroupsAgents.enabled, true),
          eq(chatGroupsAgents.userId, userId),
          isNull(chatGroupsAgents.workspaceId),
          eq(agents.userId, userId),
          isNull(agents.workspaceId),
          eq(agents.slug, GROUP_SUPERVISOR.slug),
          or(
            sql`nullif(trim(${agents.description}), '') IS NULL`,
            sql`nullif(trim(${chatGroups.content}), '') IS NULL`,
            eq(chatGroups.content, LEGACY_TRAVEL_GROUP_SYSTEM_PROMPT),
          ),
        ),
      )
      .limit(2)
      .for('update');
    if (rows.length !== 1) return false;
    const row = rows[0];
    let changed = false;
    if (!row.description?.trim()) {
      await tx
        .update(agents)
        .set({
          description: TRAVEL_GROUP_SUPERVISOR_DESCRIPTION,
          updatedAt: new Date(),
        })
        .where(
          and(eq(agents.id, row.agentId), sql`nullif(trim(${agents.description}), '') IS NULL`),
        );
      changed = true;
    }
    if (!row.content?.trim() || row.content === LEGACY_TRAVEL_GROUP_SYSTEM_PROMPT) {
      await tx
        .update(chatGroups)
        .set({
          content: DEFAULT_TRAVEL_GROUP_SYSTEM_PROMPT,
          updatedAt: new Date(),
        })
        .where(eq(chatGroups.id, groupId));
      changed = true;
    }
    return changed;
  });
};

export const checkDefaultTravelServiceGroup = async (db: LobeChatDatabase, userId: string) => {
  const accessState = await getTravelServiceGroupAccessState(db, userId);
  const groupModel = new ChatGroupModel(db, userId);
  const agentModel = new AgentModel(db, userId);
  const skillModel = new AgentSkillModel(db, userId);
  const group = await groupModel.findByClientId(DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID);
  const publishedTemplate = await getSuperGroupTemplate(db);
  const requiredTemplates = publishedTemplate.revision > 0 ? [] : TRAVEL_SPECIALIST_TEMPLATES;
  const specialists = await Promise.all(
    requiredTemplates.map(({ clientId }) => agentModel.findByClientId(clientId)),
  );
  const skills = await Promise.all(
    requiredTemplates.map(({ skillSlots }) => skillModel.findByIdentifier(skillSlots[0])),
  );
  const supervisorAgentId = group ? await groupModel.getSupervisorAgentId(group.id) : null;
  const supervisor = supervisorAgentId
    ? await agentModel.getAgentConfigById(supervisorAgentId)
    : null;
  const groupAgents = group ? await groupModel.getGroupAgents(group.id) : [];
  const supervisorMemberships = groupAgents.filter(({ role }) => role === 'supervisor');
  const supervisorDiagnostic = getTravelGroupSupervisorDiagnostic(
    supervisorMemberships.map((membership) => ({
      agencyConfig:
        membership.agentId === supervisorAgentId ? (supervisor?.agencyConfig ?? null) : null,
      enabled: membership.enabled,
      slug: membership.agentId === supervisorAgentId ? (supervisor?.slug ?? null) : null,
      title: membership.agentId === supervisorAgentId ? (supervisor?.title ?? null) : null,
    })),
    publishedTemplate.supervisor?.title,
  );
  const members = group ? await groupModel.getEnabledGroupAgents(group.id) : [];
  const supervisorInstructionsConfigured =
    Boolean(group?.content?.trim()) && group?.content !== LEGACY_TRAVEL_GROUP_SYSTEM_PROMPT;
  const expectedAgentIds = specialists.flatMap((agent) => (agent ? [agent.id] : []));
  const bindingDiagnostics = requiredTemplates.map((template, index) =>
    getRequiredMemberBindingDiagnostic(
      template,
      Array.isArray(specialists[index]?.plugins) ? specialists[index].plugins : [],
      Boolean(skills[index]),
    ),
  );
  const missingSkillIdentifiers = requiredTemplates.flatMap(({ skillSlots }, index) =>
    bindingDiagnostics[index].missingSkillIdentifier ? [skillSlots[0]] : [],
  );
  const missingSkillBindings = requiredTemplates.flatMap(({ skillSlots }, index) =>
    bindingDiagnostics[index].missingSkillBinding ? [skillSlots[0]] : [],
  );
  const missingToolBindings = bindingDiagnostics.flatMap(({ missingTools }) => missingTools);
  const missingPlatformManagedRuntimeClientIds = requiredTemplates.flatMap(({ clientId }, index) =>
    specialists[index]?.agencyConfig?.modelRuntimeMode === 'platform-managed' ? [] : [clientId],
  );
  const missingFixedModelSelectionClientIds = requiredTemplates.flatMap(({ clientId }, index) =>
    specialists[index]?.agencyConfig?.modelSelectionPolicy === 'fixed' ? [] : [clientId],
  );
  const builtinKeys = new Set<string>(TRAVEL_SPECIALIST_TEMPLATES.map(({ key }) => key));
  const customTemplateMembers = publishedTemplate.members.filter(
    ({ key }) => publishedTemplate.revision > 0 || !builtinKeys.has(key),
  );
  const customClientIds = customTemplateMembers.map(({ key }) =>
    getSuperGroupTemplateMemberClientId(key),
  );
  const customAgents =
    customClientIds.length === 0
      ? []
      : await db
          .select({
            agencyConfig: agents.agencyConfig,
            avatar: agents.avatar,
            backgroundColor: agents.backgroundColor,
            clientId: agents.clientId,
            description: agents.description,
            id: agents.id,
            model: agents.model,
            params: agents.params,
            plugins: agents.plugins,
            provider: agents.provider,
            systemRole: agents.systemRole,
            title: agents.title,
            name: agents.name,
          })
          .from(agents)
          .where(
            and(
              eq(agents.userId, userId),
              isNull(agents.workspaceId),
              inArray(agents.clientId, customClientIds),
            ),
          );
  const publishedTemplateMembersReady = customTemplateMembers.every((member) => {
    const candidates = customAgents.filter(
      ({ clientId }) => clientId === getSuperGroupTemplateMemberClientId(member.key),
    );
    return (
      candidates.length === 1 &&
      members.some(({ agentId }) => agentId === candidates[0].id) &&
      matchesPublishedTemplateMember(candidates[0], member)
    );
  });
  const specialistTemplatesMatch = requiredTemplates.every(({ key, label, systemRole }, index) => {
    const member = publishedTemplate.members.find((item) => item.key === key);
    return (
      specialists[index]?.title === (member?.title ?? label) &&
      specialists[index]?.systemRole === (member?.systemRole ?? systemRole)
    );
  });

  return {
    accessState,
    groupId: group?.id ?? null,
    groupVisibility: group?.visibility ?? null,
    memberCount: members.length,
    missingFixedModelSelectionClientIds,
    missingPlatformManagedRuntimeClientIds,
    missingSpecialistClientIds: requiredTemplates.flatMap(({ clientId }, index) =>
      specialists[index] ? [] : [clientId],
    ),
    missingSkillBindings,
    missingSkillIdentifiers,
    missingToolBindings,
    ready:
      accessState === 'active' &&
      !!group &&
      group.visibility === 'private' &&
      !!supervisorAgentId &&
      supervisorInstructionsConfigured &&
      supervisorDiagnostic.issueCodes.length === 0 &&
      missingPlatformManagedRuntimeClientIds.length === 0 &&
      missingFixedModelSelectionClientIds.length === 0 &&
      specialistTemplatesMatch &&
      publishedTemplateMembersReady &&
      skills.every(Boolean) &&
      missingSkillBindings.length === 0 &&
      missingToolBindings.length === 0 &&
      expectedAgentIds.every((id) => members.some(({ agentId }) => agentId === id)),
    supervisorAgentId,
    supervisorCount: supervisorDiagnostic.supervisor.count,
    supervisorInstructionsConfigured,
    supervisorModelRuntimeMode: supervisor?.agencyConfig?.modelRuntimeMode ?? null,
    supervisorModelSelectionPolicy: supervisor?.agencyConfig?.modelSelectionPolicy ?? null,
    supervisorSlug: supervisor?.slug ?? null,
    supervisorTitle: supervisor?.title ?? null,
  };
};
