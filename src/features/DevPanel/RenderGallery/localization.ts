import { parseGitHubToolName } from '@lobechat/shared-tool-ui/inspectors/github-labels';
import { parseToolName as parseLinearToolName } from '@lobechat/shared-tool-ui/inspectors/linear-labels';
import { type TFunction } from 'i18next';

const TOOLSET_TITLE_ZH: Record<string, string> = {
  'Agent Documents': '智能体文档',
  'Agent 文档': '智能体文档',
  'Browser': '浏览器',
  'Claude Code': 'Claude Code 编程助手',
  'Codex': 'Codex 编程助手',
  'Delivery Checker': '交付检查',
  'GitHub': 'GitHub 代码托管',
  'Github': 'GitHub 代码托管',
  'Linear': 'Linear 项目管理',
  'Lobe Agent': 'Lobe 智能体',
  'Tools Activator': '工具激活器',
};

const TOOLSET_DESCRIPTION_ZH: Record<string, string> = {
  'Browser': '打开网页、读取页面、填写表单并截取页面。',
  'Claude Code': '使用 Claude Code 执行编程、文件和任务操作。',
  'Codex': '使用 Codex 执行编程、文件和任务操作。',
  'Delivery Checker': '检查任务交付内容是否完整并符合要求。',
  'GitHub': '管理 GitHub 代码仓库、议题和拉取请求。',
  'Github': '管理 GitHub 代码仓库、议题和拉取请求。',
  'Linear': '管理 Linear 项目、问题、客户和附件。',
  'Lobe Agent': '创建、配置和管理 Lobe 智能体。',
  'Tools Activator': '搜索并启用当前任务需要的工具。',
};

const CLAUDE_CODE_API_ZH: Record<string, string> = {
  Agent: '运行子智能体',
  askUserQuestion: '向用户提问',
  Bash: '运行命令',
  Edit: '编辑文件',
  EnterWorktree: '进入工作树',
  ExitWorktree: '退出工作树',
  Glob: '查找文件',
  Grep: '搜索文件内容',
  Read: '读取文件',
  ScheduleWakeup: '定时唤醒',
  SendMessage: '发送消息',
  Skill: '运行技能',
  TaskCreate: '创建任务',
  TaskGet: '查看任务',
  TaskList: '列出任务',
  TaskOutput: '查看任务输出',
  TaskStop: '停止任务',
  TaskUpdate: '更新任务',
  TodoWrite: '更新待办事项',
  ToolSearch: '搜索工具',
  WebFetch: '读取网页',
  WebSearch: '搜索网页',
  Write: '写入文件',
};

const BROWSER_API_ZH: Record<string, string> = {
  click: '点击元素',
  fill: '填写输入框',
  navigate: '打开页面',
  press: '按下按键',
  readPage: '读取页面文本',
  screenshot: '截取页面',
  scroll: '滚动页面',
  snapshot: '读取页面元素',
};

const ACTIVATOR_API_ZH: Record<string, string> = {
  activateSkill: '激活技能',
  activateTools: '激活工具',
};

const LINEAR_VERB_ZH: Record<string, string> = {
  create: '创建',
  delete: '删除',
  extract: '提取',
  get: '获取',
  list: '列出',
  prepare: '准备',
  save: '保存',
  search: '搜索',
};

const LINEAR_NOUN_ZH: Record<string, string> = {
  'attachment': '附件',
  'attachment upload': '附件上传',
  'comment': '评论',
  'comments': '评论',
  'customer': '客户',
  'customer need': '客户需求',
  'customers': '客户',
  'cycle': '周期',
  'cycles': '周期',
  'diff': '差异',
  'diff threads': '差异讨论',
  'diffs': '差异',
  'docs': '帮助文档',
  'document': '文档',
  'documents': '文档',
  'images': '图片',
  'initiative': '计划',
  'initiatives': '计划',
  'issue': '问题',
  'issue label': '问题标签',
  'issue labels': '问题标签',
  'issue status': '问题状态',
  'issue statuses': '问题状态',
  'issues': '问题',
  'milestone': '里程碑',
  'milestones': '里程碑',
  'project': '项目',
  'project labels': '项目标签',
  'projects': '项目',
  'status update': '状态更新',
  'status updates': '状态更新',
  'team': '团队',
  'teams': '团队',
  'user': '用户',
  'users': '用户',
};

const GITHUB_VERB_ZH: Record<string, string> = {
  add: '添加',
  check: '检查',
  close: '关闭',
  compare: '对比',
  create: '创建',
  delete: '删除',
  fork: '派生',
  get: '获取',
  list: '列出',
  merge: '合并',
  reopen: '重新打开',
  request: '请求',
  search: '搜索',
  update: '更新',
};

const GITHUB_NOUN_ZH: Record<string, string> = {
  'branch': '分支',
  'branches': '分支',
  'code': '代码',
  'comment': '评论',
  'commit': '提交记录',
  'commits': '提交记录',
  'file': '文件',
  'issue': '议题',
  'issues': '议题',
  'mergeability': '可合并性',
  'pull request': '拉取请求',
  'pull request mergeability': '拉取请求可合并性',
  'pull requests': '拉取请求',
  'repositories': '代码仓库',
  'repository': '代码仓库',
  'review': '审核',
};

const SPECIAL_API_ZH: Record<string, string> = {
  'codex:error': '错误信息',
  'github:run_command': '运行命令',
  'github:runCommand': '运行命令',
  'lobe-agent:askUserQuestion': '向用户提问',
  'lobe-group-agent-builder:batchCreateAgents': '批量创建智能体',
  'lobe-group-agent-builder:updateConfig': '更新助理配置',
  'lobe-group-management:executeAgentTask': '执行智能体任务',
  'lobe-group-management:executeAgentTasks': '并行执行智能体任务',
  'lobe-skills:runSkill': '运行技能',
};

const getStructuredApiLabel = (identifier: string, apiName: string): string | undefined => {
  const normalizedIdentifier = identifier.toLowerCase();
  const specialLabel = SPECIAL_API_ZH[`${normalizedIdentifier}:${apiName}`];
  if (specialLabel) return specialLabel;

  if (normalizedIdentifier.includes('claude')) return CLAUDE_CODE_API_ZH[apiName];

  if (normalizedIdentifier === 'lobe-browser') return BROWSER_API_ZH[apiName];

  if (normalizedIdentifier === 'lobe-activator') return ACTIVATOR_API_ZH[apiName];

  if (normalizedIdentifier === 'linear') {
    if (apiName === 'create_attachment_from_upload') return '从上传内容创建附件';
    const parsed = parseLinearToolName(apiName);
    const verb = LINEAR_VERB_ZH[parsed.verb];
    const noun = LINEAR_NOUN_ZH[parsed.noun];
    return verb && noun ? `${verb}${noun}` : undefined;
  }

  if (normalizedIdentifier === 'github') {
    const normalizedApiName = apiName.replace(/^github_/, '');
    const parsed = parseGitHubToolName(normalizedApiName);
    const verb = GITHUB_VERB_ZH[parsed.verb];
    const noun = GITHUB_NOUN_ZH[parsed.noun];
    return verb && noun ? `${verb}${noun}` : undefined;
  }
};

interface RenderGalleryApiMeta {
  apiName: string;
  description?: string;
  identifier: string;
}

interface RenderGalleryToolsetMeta {
  identifier: string;
  toolsetDescription?: string;
  toolsetName: string;
}

export const localizeRenderGalleryApi = <T extends RenderGalleryApiMeta>(
  api: T,
  t: TFunction<'plugin'>,
) => {
  const structuredLabel = getStructuredApiLabel(api.identifier, api.apiName);
  let description: string | undefined;

  if (structuredLabel) {
    description = `执行“${structuredLabel}”操作。`;
  } else if (api.description) {
    description = t(`builtins.${api.identifier}.apiDescription.${api.apiName}`, {
      defaultValue: api.description,
    });
  }

  return {
    ...api,
    apiDisplayName:
      structuredLabel ||
      t(`builtins.${api.identifier}.apiName.${api.apiName}`, {
        defaultValue: api.apiName,
      }),
    description,
  };
};

export const localizeRenderGalleryToolset = <T extends RenderGalleryToolsetMeta>(
  toolset: T,
  t: TFunction<'plugin'>,
) => {
  const translatedName = t(`builtins.${toolset.identifier}.title`, {
    defaultValue: toolset.toolsetName,
  });

  return {
    ...toolset,
    toolsetDescription:
      TOOLSET_DESCRIPTION_ZH[translatedName] ||
      TOOLSET_DESCRIPTION_ZH[toolset.toolsetName] ||
      (toolset.toolsetDescription
        ? t(`builtins.${toolset.identifier}.description`, {
            defaultValue: toolset.toolsetDescription,
          })
        : undefined),
    toolsetName:
      TOOLSET_TITLE_ZH[translatedName] ||
      TOOLSET_TITLE_ZH[toolset.toolsetName] ||
      (/\p{Script=Han}/u.test(toolset.toolsetName) ? toolset.toolsetName : translatedName),
  };
};
