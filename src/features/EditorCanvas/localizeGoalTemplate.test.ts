import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { localizeGoalEditorData, localizeGoalTemplate } from './localizeGoalTemplate';
import { platformTemplateCopy } from './platformTemplateCopy';

describe('platform template localization', () => {
  it('shows the legacy goal headings in Chinese without changing the user requirements', () => {
    const input =
      '**Scope:** 厦门亲子文案\n**Acceptance criteria** — every one must be satisfied with concrete evidence:\n*How to judge:* 30 字以内';
    const result = localizeGoalTemplate(input, 'zh-CN');
    expect(result).toContain('**工作范围：** 厦门亲子文案');
    expect(result).toContain('**完成标准** — 每一项都要提供实际结果或证据，才能算完成：');
    expect(result).toContain('*检查方法：* 30 字以内');
  });

  it('translates every known platform paragraph and preserves English mode', () => {
    for (const [source, chinese] of Object.entries(platformTemplateCopy)) {
      expect(localizeGoalTemplate(source, 'zh-CN')).toBe(chinese);
      expect(localizeGoalTemplate(source, 'en-US')).toBe(source);
    }
  });

  it('preserves code, URLs, names and arbitrary English prose', () => {
    const input =
      'DeepSeek V4 Flash\nMy own English requirement.\n`Scope:`\n```text\nScope: keep this\n```\nhttps://example.com/Scope:test';
    expect(localizeGoalTemplate(input, 'zh-CN')).toBe(input);
  });

  it('protects an unfinished code fence during streaming', () => {
    const input = '```text\nScope: untouched';
    expect(localizeGoalTemplate(input, 'zh-CN')).toBe(input);
  });

  it('keeps the goal name in the acceptance context', () => {
    expect(
      localizeGoalTemplate(
        'This Task is one direction of the Goal "厦门旅行"; the full Goal contract is verified separately at the end.',
        'zh-CN',
      ),
    ).toBe('本任务属于目标“厦门旅行”的一部分；整个目标的完成情况会在最后单独验收。');
  });

  it('preserves rich-text metadata, links and code nodes without mutating stored data', () => {
    const input = {
      type: 'root',
      children: [
        { type: 'text', text: 'Scope: 文案' },
        { type: 'code', children: [{ type: 'text', text: 'Scope: code' }] },
        {
          type: 'link',
          url: 'https://example.com/Scope:',
          children: [{ type: 'text', text: '自定义链接' }],
        },
      ],
    };
    const before = JSON.stringify(input);
    const output = localizeGoalEditorData(input, 'zh-CN');
    expect(output.children[0].text).toBe('工作范围： 文案');
    expect(output.children.slice(1)).toEqual(input.children.slice(1));
    expect(JSON.stringify(input)).toBe(before);
    expect(localizeGoalEditorData(input, 'en-US')).toBe(input);
  });
});

it('localizes headings embedded inside flattened acceptance summaries', () => {
  const input =
    '文案。 *How to judge:* 检查。 **Scope:** 范围。 **Acceptance criteria** — every one must be satisfied with concrete evidence:';
  expect(localizeGoalTemplate(input, 'zh-CN')).not.toMatch(
    /How to judge|Scope:|Acceptance criteria/,
  );
});

it('localizes the terminal acceptance title and delivery prefix in old tasks', () => {
  const input =
    'Current Task contract (authoritative execution scope): Complete full Goal acceptance\nRequired delivery: Complete and prove the overall Goal acceptance requirement: 用户要求';
  expect(localizeGoalTemplate(input, 'zh-CN')).not.toMatch(/Complete|Required delivery/);
});

it('covers every fixed prose paragraph authored by the goal instruction and acceptance builders', () => {
  const source = readFileSync('apps/server/src/services/goal/index.ts', 'utf8');
  const blocks = [
    source.slice(
      source.indexOf('  private buildTaskInstruction ='),
      source.indexOf('  private planDecomposition ='),
    ),
    source.slice(
      source.indexOf('  private buildTaskAcceptanceRequirement ='),
      source.indexOf('  private buildTaskAcceptanceRequirement =') + 2100,
    ),
    source.slice(
      source.indexOf('        `Complete and prove the overall'),
      source.indexOf('      kind:', source.indexOf('        `Complete and prove the overall')),
    ),
  ];
  const paragraphs = blocks.flatMap((block) =>
    [...block.matchAll(/^\s*'([A-Z][^'\n]{50,})',?$/gm)].map((match) => match[1]),
  );
  expect(paragraphs.length).toBeGreaterThanOrEqual(15);
  for (const paragraph of paragraphs) {
    expect(localizeGoalTemplate(paragraph, 'zh-CN'), paragraph).not.toBe(paragraph);
    expect(localizeGoalTemplate(paragraph, 'en-US')).toBe(paragraph);
  }
});
