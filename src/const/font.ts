const FONT_EN = [
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI',
  'Roboto',
  'Helvetica Neue',
  'Arial',
];

const FONT_SC = [
  'PingFang SC',
  'Microsoft YaHei UI',
  'Microsoft YaHei',
  'Hiragino Sans GB',
  'HarmonyOS Sans SC',
  'Noto Sans CJK SC',
  'Source Han Sans SC',
];

const FONT_TC = [
  'PingFang TC',
  'Hiragino Sans CNS',
  'Microsoft JhengHei UI',
  'Microsoft JhengHei',
  'Source Han Sans TC',
  'Noto Sans CJK TC',
];

const FONT_JP = [
  'Hiragino Sans',
  'Hiragino Kaku Gothic ProN',
  'Yu Gothic UI',
  'Yu Gothic',
  'Meiryo',
  'Source Han Sans JP',
  'Noto Sans CJK JP',
];

const FONT_KR = ['Apple SD Gothic Neo', 'Malgun Gothic', 'Source Han Sans KR', 'Noto Sans CJK KR'];

const FONT_CODE = [
  'ui-monospace',
  'SFMono-Regular',
  'SF Mono',
  'Menlo',
  'Cascadia Code',
  'Consolas',
  'Liberation Mono',
];

const FALLBACK = ['ui-sans-serif', 'system-ui', 'sans-serif'];

const FALLBACK_CODE = ['monospace'];

const FONT_EMOJI = ['Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'];

// Han glyphs differ per region, so the locale's own CJK family must win over the
// SC families that stay in the stack as the last-resort CJK fallback.
const LOCALE_CJK_FONTS: Record<string, string[]> = {
  'ja-JP': FONT_JP,
  'ko-KR': FONT_KR,
  'zh-TW': FONT_TC,
};

// user / env values may already be a full CSS font-family list, so leave those alone
const quote = (font: string) =>
  font.includes(',') || font.includes('"') || !font.includes(' ') ? font : `"${font}"`;

interface GenFontFamilyParams {
  customFontFamily?: string;
  locale?: string;
  userFontFamily?: string;
}

export const genFontFamily = ({
  customFontFamily,
  locale,
  userFontFamily,
}: GenFontFamilyParams = {}) =>
  [
    userFontFamily?.trim(),
    ...FONT_EN,
    ...(locale ? (LOCALE_CJK_FONTS[locale] ?? []) : []),
    ...FONT_SC,
    // Environment-provided web fonts are fallback-only: system fonts stay on the
    // critical rendering path, while an explicit user selection still wins above.
    customFontFamily?.trim(),
    ...FALLBACK,
    ...FONT_EMOJI,
  ]
    .filter(Boolean)
    .map((font) => quote(font as string))
    .join(',');

export const genFontFamilyCode = ({ locale, userFontFamily }: GenFontFamilyParams = {}) =>
  [
    userFontFamily?.trim(),
    ...FONT_CODE,
    ...(locale ? (LOCALE_CJK_FONTS[locale] ?? []) : []),
    ...FONT_SC,
    ...FALLBACK_CODE,
    ...FONT_EMOJI,
  ]
    .filter(Boolean)
    .map((font) => quote(font as string))
    .join(',');
