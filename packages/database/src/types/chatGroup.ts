import type { AgentPluginEntry, LobeChatGroupChatConfig, SkillResourceMeta } from '@lobechat/types';

export interface SuperGroupTemplateMember {
  avatar: string | null;
  /** Omitted by legacy templates; null explicitly clears the avatar background. */
  backgroundColor?: string | null;
  description: string;
  key: string;
  model?: string;
  /** Display name, separate from the occupational title. Legacy templates omit this. */
  name?: string;
  params?: Record<string, number>;
  /** Original member is present, but cannot execute until its dependencies are published. */
  pendingReason?: string;
  pluginBindings?: AgentPluginEntry[];
  plugins: string[];
  provider?: string;
  skills?: Array<{
    identifier: string;
    name: string;
    description: string;
    content: string;
    source: 'builtin' | 'market' | 'user';
    /** Resource snapshot explicitly approved by the publishing administrator. */
    resources?: Record<string, SkillResourceMeta>;
    zipFileHash?: string | null;
  }>;
  sourceAgentId?: string;
  systemRole: string;
  title: string;
}

export interface SuperGroupTemplate {
  members: SuperGroupTemplateMember[];
  revision: number;
  supervisor?: SuperGroupTemplateMember;
}

export interface ChatGroupConfig {
  allowDM?: boolean;
  forkedFromIdentifier?: string;
  maxDiscussionRounds?: number;
  memberSlots?: LobeChatGroupChatConfig['memberSlots'];
  openingMessage?: string;
  openingQuestions?: string[];
  revealDM?: boolean;
  /** Server-owned template, stored only on the first publishing administrator's default group. */
  superGroupTemplate?: SuperGroupTemplate;
  systemPrompt?: string;
}
