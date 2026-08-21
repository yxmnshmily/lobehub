import { type TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import { localizeRenderGalleryApi, localizeRenderGalleryToolset } from './localization';

const createTranslator = (translations: Record<string, string> = {}) =>
  vi.fn(
    (key: string, options?: { defaultValue?: string }) =>
      translations[key] ?? options?.defaultValue ?? key,
  ) as unknown as TFunction<'plugin'>;

describe('Render Gallery localization', () => {
  it('shows the localized toolset title while preserving its identifier', () => {
    const t = createTranslator({
      'builtins.lobe-agent-builder.title': '助理构建专家',
    });

    expect(
      localizeRenderGalleryToolset(
        {
          identifier: 'lobe-agent-builder',
          toolsetDescription: 'Build and configure agents',
          toolsetName: 'Agent Builder',
        },
        t,
      ),
    ).toEqual({
      identifier: 'lobe-agent-builder',
      toolsetDescription: 'Build and configure agents',
      toolsetName: '助理构建专家',
    });
  });

  it('shows a localized API name and description while preserving the callable name', () => {
    const t = createTranslator({
      'builtins.lobe-agent-builder.apiDescription.getAvailableModels': '获取可用模型及能力。',
      'builtins.lobe-agent-builder.apiName.getAvailableModels': '获取可用模型',
    });

    expect(
      localizeRenderGalleryApi(
        {
          apiName: 'getAvailableModels',
          description: 'Get all available models and capabilities.',
          identifier: 'lobe-agent-builder',
        },
        t,
      ),
    ).toEqual({
      apiDisplayName: '获取可用模型',
      apiName: 'getAvailableModels',
      description: '获取可用模型及能力。',
      identifier: 'lobe-agent-builder',
    });
  });

  it('falls back to the existing labels when a translation is unavailable', () => {
    const t = createTranslator();

    expect(
      localizeRenderGalleryApi(
        {
          apiName: 'customAction',
          description: 'Custom action description',
          identifier: 'custom-tool',
        },
        t,
      ),
    ).toMatchObject({
      apiDisplayName: 'customAction',
      description: 'Custom action description',
    });
  });

  it.each([
    ['Claude Code', 'Claude Code 编程助手'],
    ['Browser', '浏览器'],
    ['Agent 文档', '智能体文档'],
    ['Codex', 'Codex 编程助手'],
    ['Delivery Checker', '交付检查'],
    ['Github', 'GitHub 代码托管'],
    ['Linear', 'Linear 项目管理'],
    ['Lobe Agent', 'Lobe 智能体'],
    ['Tools Activator', '工具激活器'],
  ])('uses a Chinese product label for an untranslated %s toolset', (rawTitle, expected) => {
    const t = createTranslator();

    expect(
      localizeRenderGalleryToolset(
        {
          identifier: rawTitle.toLowerCase().replaceAll(' ', '-'),
          toolsetName: rawTitle,
        },
        t,
      ).toolsetName,
    ).toBe(expected);
  });

  it.each([
    ['linear', 'delete_attachment', '删除附件'],
    ['linear', 'create_attachment_from_upload', '从上传内容创建附件'],
    ['github', 'create_pull_request', '创建拉取请求'],
    ['github', 'search_repositories', '搜索代码仓库'],
    ['claude-code', 'Bash', '运行命令'],
    ['claude-code', 'TaskCreate', '创建任务'],
    ['lobe-browser', 'click', '点击元素'],
    ['lobe-browser', 'fill', '填写输入框'],
    ['lobe-browser', 'navigate', '打开页面'],
    ['lobe-browser', 'press', '按下按键'],
    ['lobe-browser', 'readPage', '读取页面文本'],
    ['lobe-browser', 'screenshot', '截取页面'],
    ['lobe-browser', 'scroll', '滚动页面'],
    ['lobe-browser', 'snapshot', '读取页面元素'],
    ['lobe-activator', 'activateSkill', '激活技能'],
    ['lobe-activator', 'activateTools', '激活工具'],
    ['lobe-skills', 'runSkill', '运行技能'],
    ['lobe-group-agent-builder', 'batchCreateAgents', '批量创建智能体'],
    ['lobe-group-agent-builder', 'updateConfig', '更新助理配置'],
    ['lobe-group-management', 'executeAgentTask', '执行智能体任务'],
    ['lobe-group-management', 'executeAgentTasks', '并行执行智能体任务'],
    ['codex', 'error', '错误信息'],
    ['lobe-agent', 'askUserQuestion', '向用户提问'],
    ['github', 'check_pull_request_mergeability', '检查拉取请求可合并性'],
    ['github', 'github_create_pull_request', '创建拉取请求'],
    ['github', 'github_check_pull_request_mergeability', '检查拉取请求可合并性'],
    ['github', 'run_command', '运行命令'],
    ['github', 'runCommand', '运行命令'],
  ])('uses a Chinese display name for untranslated %s API %s', (identifier, apiName, expected) => {
    const t = createTranslator();

    expect(
      localizeRenderGalleryApi(
        {
          apiName,
          identifier,
        },
        t,
      ).apiDisplayName,
    ).toBe(expected);
  });

  it('keeps the curated Chinese toolset name when English fallback resources exist', () => {
    const t = createTranslator({ 'builtins.lobe-agent-documents.title': 'Agent 文档' });

    expect(
      localizeRenderGalleryToolset(
        {
          identifier: 'lobe-agent-documents',
          toolsetName: '智能体文档',
        },
        t,
      ).toolsetName,
    ).toBe('智能体文档');
  });

  it('replaces untranslated Linear descriptions with Chinese copy', () => {
    const t = createTranslator();

    expect(
      localizeRenderGalleryApi(
        {
          apiName: 'delete_attachment',
          description: 'Delete an attachment',
          identifier: 'linear',
        },
        t,
      ).description,
    ).toBe('执行“删除附件”操作。');

    expect(
      localizeRenderGalleryToolset(
        {
          identifier: 'linear',
          toolsetDescription: 'Manage Linear projects and issues',
          toolsetName: 'Linear',
        },
        t,
      ).toolsetDescription,
    ).toBe('管理 Linear 项目、问题、客户和附件。');
  });
});
