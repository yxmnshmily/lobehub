import { DEFAULT_LANG } from '@/const/locale';

import type resources from './default';

export const locales = ['en-US', 'zh-CN'] as const;

export type DefaultResources = typeof resources;
export type NS = keyof DefaultResources;
export type Locales = (typeof locales)[number];

export const matchLocale = (locale?: string): Locales | undefined => {
  if (!locale) return undefined;

  const lowerLocale = locale.toLowerCase();

  if (/^(?:zh|cn)(?:-|$)/.test(lowerLocale)) return 'zh-CN';
  if (/^en(?:-|$)/.test(lowerLocale)) return 'en-US';

  return undefined;
};

export const normalizeLocale = (locale?: string): Locales => matchLocale(locale) ?? DEFAULT_LANG;

type LocaleOptions = {
  label: string;
  value: Locales;
}[];

export const localeOptions: LocaleOptions = [
  { label: '简体中文', value: 'zh-CN' },
  { label: 'English', value: 'en-US' },
];

export const supportLocales: string[] = [...locales, 'en', 'zh'];
