/** App-owned explanations follow the configured language; protocol values stay stable. */
export const outputLanguageInstruction = (locale?: string) =>
  /^en(?:-|$)/i.test(locale || '')
    ? 'Write all user-facing explanations, summaries, verification reasoning, evidence descriptions and limitations in English. Preserve JSON keys, enum values, identifiers, code, URLs and verbatim evidence quotations unchanged.'
    : '所有面向用户的对话说明、摘要、检查结论、判断依据、证据说明、反证和局限必须使用简体中文。不要因为系统提示词或证据使用英文就改用英文。JSON 字段名、枚举值、标识符、代码、网址及逐字引用的证据保持原样。用户明确要求的外语翻译或外语成品按其要求生成，外围解释仍用中文。';
