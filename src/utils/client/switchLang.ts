import { setCookie } from '@lobechat/utils';
import { changeLanguage } from 'i18next';

import { LOBE_LOCALE_COOKIE } from '@/const/locale';
import { type LocaleMode } from '@/types/locale';
import { getSystemLanguage } from '@/utils/client/systemLanguage';

export const resolveLang = (locale: LocaleMode) =>
  locale === 'auto' ? getSystemLanguage() : locale;

export const switchLang = (locale: LocaleMode) => {
  const lang = resolveLang(locale);

  document.documentElement.lang = lang;
  changeLanguage(lang);

  setCookie(LOBE_LOCALE_COOKIE, locale === 'auto' ? undefined : locale, 365);
};
