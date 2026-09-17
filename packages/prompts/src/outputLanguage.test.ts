import { expect, it } from 'vitest';

import { outputLanguageInstruction } from './outputLanguage';

it('defaults to Chinese and preserves protocol and evidence values', () => {
  expect(outputLanguageInstruction()).toContain('简体中文');
  expect(outputLanguageInstruction('zh-CN')).toContain('枚举值');
  expect(outputLanguageInstruction('zh-CN')).toContain('逐字引用');
});
it('uses English only for an explicit English language', () => {
  expect(outputLanguageInstruction('en-US')).toContain('in English');
  expect(outputLanguageInstruction('en')).toContain('in English');
  expect(outputLanguageInstruction('auto')).toContain('简体中文');
});
