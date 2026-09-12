/**
 * 页面样式修改器写回的「设置页留白」覆盖表。
 *
 * 为什么单独一个文件：原先这些写入落在 features/Settings/features/SettingsContent.tsx，
 * 但该文件有并发写入者（另一个任务反复改写），写进去会被覆盖。
 * 这个文件只由修改器写入，避免互相覆盖。
 *
 * 数据来源：website/assets/data/css-modifier-rules.json（用户在页面上调过的真实规则，2026-09-11 提取）
 */
export interface CssModifierPadding {
  bottom?: number;
  left?: number;
  right?: number;
  top?: number;
}

/** 键 = 设置页的 tab 键（componentMap 的字符串键，例如 skill / stats / provider） */
export const CSS_MODIFIER_PADDING: Record<string, CssModifierPadding> = {
  'connector': { top: 4, right: 48, left: 48 },
  'content-moderation': { top: 0, right: 0, bottom: 0, left: 0 },
  'profile': { bottom: 48 },
  'provider': { top: 24, right: 24, bottom: 24, left: 24 },
  'service-operations': { top: 0, right: 0, bottom: 0, left: 0 },
  'skill': { left: 48 },
  'stats': { top: 24, bottom: 16, left: 35 },
  'usage': { top: 48 },
};
