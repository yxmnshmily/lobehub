'use client';

import { builtinTools } from '@lobechat/builtin-tools';
import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import type { BuiltinToolManifest, LobeChatPluginApi } from '@lobechat/types';

import type { ToolRenderFixture } from '../lifecycleMode';
import { buildSchemaSample, humanize, single, type ToolsetFixtureModule } from './_helpers';
import claudeCode from './claude-code';
import codex from './codex';
import github from './github';
import kimiCode from './kimi-code';
import linear from './linear';
import lobeActivator from './lobe-activator';
import lobeAgent from './lobe-agent';
import lobeAgentBuilder from './lobe-agent-builder';
import lobeAgentDocuments from './lobe-agent-documents';
import lobeAgentManagement from './lobe-agent-management';
import lobeBrowser from './lobe-browser';
import lobeCloudSandbox from './lobe-cloud-sandbox';
import lobeGroupAgentBuilder from './lobe-group-agent-builder';
import lobeGroupManagement from './lobe-group-management';
import lobeImageGeneration from './lobe-image-generation';
import lobeKnowledgeBase from './lobe-knowledge-base';
import lobeLocalSystem from './lobe-local-system';
import lobeNotebook from './lobe-notebook';
import lobePageAgent from './lobe-page-agent';
import lobeSkillStore from './lobe-skill-store';
import lobeSkills from './lobe-skills';
import lobeTask from './lobe-task';
import lobeUserInteraction from './lobe-user-interaction';
import lobeUserMemory from './lobe-user-memory';
import lobeWebBrowsing from './lobe-web-browsing';
import lobeWebOnboarding from './lobe-web-onboarding';
import { lobeAuv } from './lobeAuv';

export type { ToolRenderFixture, ToolRenderFixtureVariant } from '../lifecycleMode';

export interface ToolRenderMeta {
  api?: LobeChatPluginApi;
  apiName: string;
  description?: string;
  identifier: string;
  toolsetDescription?: string;
  toolsetName: string;
}

export const DEVTOOLS_GROUP_ID = 'devtools-preview-group';

/**
 * Identity for the seeded Aggregate-preview conversation. The fixture messages
 * resolve their avatar/name through this agentId, so seeding `agentMap` with
 * this meta makes the preview turn read as "Lobe AI" instead of the
 * unresolved-agent fallback ("Unnamed Assistant").
 */
export const DEVTOOLS_AGENT_ID = 'devtools-render-gallery';

export const DEVTOOLS_AGENT_META = {
  avatar: DEFAULT_INBOX_AVATAR,
  title: 'Lobe AI',
};

export const DEVTOOLS_GROUP_DETAIL = {
  agents: [
    {
      avatar: '🧭',
      backgroundColor: '#E8F3FF',
      id: 'researcher-agent',
      title: 'Researcher',
    },
    {
      avatar: '🛠',
      backgroundColor: '#FFF3E8',
      id: 'builder-agent',
      title: 'Builder',
    },
  ],
  avatar: '👥',
  backgroundColor: '#EEF2FF',
  description: 'Fixture group used by /devtools to preview grouped task renders.',
  id: DEVTOOLS_GROUP_ID,
  title: 'Devtools Preview Group',
};

const toolsetModules: ToolsetFixtureModule[] = [
  claudeCode,
  codex,
  github,
  kimiCode,
  linear,
  lobeActivator,
  lobeAgent,
  lobeAgentBuilder,
  lobeAgentDocuments,
  lobeAgentManagement,
  lobeAuv,
  lobeBrowser,
  lobeCloudSandbox,
  lobeGroupAgentBuilder,
  lobeGroupManagement,
  lobeImageGeneration,
  lobeKnowledgeBase,
  lobeLocalSystem,
  lobeNotebook,
  lobePageAgent,
  lobeSkillStore,
  lobeSkills,
  lobeTask,
  lobeUserInteraction,
  lobeUserMemory,
  lobeWebBrowsing,
  lobeWebOnboarding,
];

const fixtureRegistry = new Map<string, ToolRenderFixture>();
const customToolsets = new Map<string, ToolsetFixtureModule>();

const TOOLSET_NAME_ZH: Record<string, string> = {
  'agent-signal-review': '智能体信号夜间复盘',
  'agent-signal-reflection': '智能体自我反思',
  'claude-code': 'Claude Code',
  'codex': 'Codex',
  'github': 'GitHub',
  'linear': 'Linear',
  'lobe-activator': '工具激活器',
  'lobe-agent': 'Lobe 智能体',
  'lobe-agent-builder': '智能体构建器',
  'lobe-agent-documents': '智能体文档',
  'lobe-agent-management': '智能体管理',
  'lobe-brief': '简报工具',
  'lobe-browser': '浏览器',
  'lobe-cloud-sandbox': '云端沙箱',
  'lobe-creds': '凭证管理',
  'lobe-delivery-checker': '交付检查',
  'lobe-group-agent-builder': '群组智能体构建器',
  'lobe-group-management': '群组管理',
  'lobe-image-generation': '图像生成',
  'lobe-knowledge-base': '知识库',
  'lobe-local-system': '本地系统',
  'lobe-page-agent': '页面智能体',
  'lobe-remote-device': '远程设备',
  'lobe-skill-store': '技能商店',
  'lobe-skills': '技能',
  'lobe-task': '任务工具',
  'lobe-topic-reference': '话题引用',
  'lobe-user-interaction': '用户交互',
  'lobe-user-memory': '用户记忆',
  'lobe-verify': '交付检查验证器',
  'lobe-web-browsing': '网页浏览',
  'lobe-web-onboarding': '网页新手引导',
};

const API_DESCRIPTION_ZH: Record<string, string> = {
  'lobe-agent-builder:getAvailableModels':
    '获取智能体可用的全部 AI 模型和服务商，并列出视觉、函数调用、推理等能力。',
  'lobe-agent-builder:installPlugin':
    '为智能体安装插件。安装前始终需要用户批准；需要授权的工具会引导用户完成连接。',
  'lobe-agent-builder:searchMarketTools': '在市场中搜索 MCP 插件，浏览并安装新的工具能力。',
  'lobe-agent-builder:updateAgentConfig':
    '更新智能体配置或资料，包括模型、服务商、插件、开场消息、参数、名称和头像等。',
  'lobe-agent-builder:updatePrompt': '更新智能体的系统提示词，定义智能体的行为和回答方式。',
};

for (const toolset of toolsetModules) {
  customToolsets.set(toolset.identifier, toolset);
  for (const [apiName, fixture] of Object.entries(toolset.fixtures)) {
    fixtureRegistry.set(`${toolset.identifier}:${apiName}`, fixture);
  }
}

const manifestByIdentifier = new Map<string, BuiltinToolManifest>(
  builtinTools.map((tool) => [tool.identifier, tool.manifest]),
);

export const getToolRenderFixture = (
  identifier: string,
  apiName: string,
  api?: LobeChatPluginApi,
): ToolRenderFixture => {
  const fixture = fixtureRegistry.get(`${identifier}:${apiName}`);
  if (fixture) return fixture;

  return single({
    args: buildSchemaSample(api?.parameters, apiName) || {},
  });
};

export const getToolRenderMeta = (identifier: string, apiName: string): ToolRenderMeta => {
  const manifest = manifestByIdentifier.get(identifier);
  const api = manifest?.api.find((item) => item.name === apiName);
  const customToolset = customToolsets.get(identifier);
  const customApi = customToolset?.apiList?.find((item) => item.name === apiName);

  return {
    api,
    apiName,
    description:
      API_DESCRIPTION_ZH[`${identifier}:${apiName}`] || api?.description || customApi?.description,
    identifier,
    toolsetDescription: manifest?.meta.description || customToolset?.meta?.description,
    toolsetName:
      TOOLSET_NAME_ZH[identifier] ||
      manifest?.meta.title ||
      customToolset?.meta?.title ||
      humanize(identifier),
  };
};
