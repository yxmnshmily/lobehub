import { platformTemplateCopy } from './platformTemplateCopy';

const translateProse = (text: string): string => {
  let result = text;
  for (const [source, translated] of Object.entries(platformTemplateCopy))
    result = result.replaceAll(source, translated);
  return result
    .replaceAll(/\bAcceptance criteria(?=\*\*|\s*[—:：]|$)/gm, '完成标准')
    .replaceAll(
      'every one must be satisfied with concrete evidence:',
      '每一项都要提供实际结果或证据，才能算完成：',
    )
    .replaceAll(/\bHow to judge:/g, '检查方法：')
    .replaceAll(/\bScope:/g, '工作范围：')
    .replaceAll('Overall goal context (background only):', '总目标背景（仅供参考）：')
    .replaceAll(
      'Overall goal acceptance context (background only):',
      '总目标完成标准（仅供参考）：',
    )
    .replaceAll(
      'Current Task contract (authoritative execution scope):',
      '当前任务要求（以此为准）：',
    )
    .replaceAll('Verify only this Task:', '本次只检查这个任务：')
    .replaceAll('Required Task outcome:', '本任务应完成的结果：')
    .replaceAll(
      /This Task is one direction of the Goal "([^"\n]+)"; the full Goal contract is verified separately at the end\./g,
      '本任务属于目标“$1”的一部分；整个目标的完成情况会在最后单独验收。',
    );
};

/** Localize known platform templates, never code snippets, URLs, or arbitrary prose. */
export const localizeGoalTemplate = (text: string, language = 'en-US'): string => {
  if (!language.startsWith('zh')) return text;
  return text
    .split(/(`{3,}[\s\S]*?(?:`{3,}|$)|~{3,}[\s\S]*?(?:~{3,}|$)|`[^`\n]*`|https?:\/\/[^\s<>]+)/g)
    .map((part, index) => (index % 2 ? part : translateProse(part)))
    .join('');
};

/** Preserve node structure, code blocks, links and non-text metadata. */
export const localizeGoalEditorData = <T>(value: T, language = 'en-US'): T => {
  if (!language.startsWith('zh') || value == null) return value;
  if (Array.isArray(value)) return value.map((item) => localizeGoalEditorData(item, language)) as T;
  if (typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (typeof record.type === 'string' && /code|highlight/i.test(record.type)) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      key === 'text' && typeof item === 'string'
        ? localizeGoalTemplate(item, language)
        : localizeGoalEditorData(item, language),
    ]),
  ) as T;
};
