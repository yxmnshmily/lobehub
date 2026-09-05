import { useEffect, useState } from 'react';

import { LOBE_LOCALE_COOKIE } from '@/const/locale';
import { matchLocale, normalizeLocale } from '@/locales/resources';

import { createAuthI18n } from './createAuthI18n';

const SYSTEM_STATUS_KEY = 'LOBE_SYSTEM_STATUS';

const readPersistedLocale = () => {
  try {
    const cookie = document.cookie
      .split('; ')
      .find((item) => item.startsWith(`${LOBE_LOCALE_COOKIE}=`));
    if (!cookie) return;

    return matchLocale(decodeURIComponent(cookie.slice(LOBE_LOCALE_COOKIE.length + 1)));
  } catch {
    return;
  }
};

const syncBackendLanguagePreference = (language: string) => {
  try {
    const persisted = JSON.parse(localStorage.getItem(SYSTEM_STATUS_KEY) || '{}');
    localStorage.setItem(SYSTEM_STATUS_KEY, JSON.stringify({ ...persisted, language }));
  } catch {
    localStorage.setItem(SYSTEM_STATUS_KEY, JSON.stringify({ language }));
  }
};

export const useAuthLocale = (defaultLang = 'zh-CN') => {
  const [initialLang] = useState(() => readPersistedLocale() || normalizeLocale(defaultLang));
  const [i18n] = useState(() => createAuthI18n(initialLang));
  const [lang, setLang] = useState(initialLang);

  if (!i18n.instance.isInitialized) {
    i18n.init();
  }

  useEffect(() => {
    const handleLang = (lng: string) => {
      document.documentElement.dir = 'ltr';
      document.documentElement.lang = lng;
      setLang((prev) => (prev === lng ? prev : lng));
      syncBackendLanguagePreference(lng);
    };

    document.documentElement.dir = 'ltr';
    document.documentElement.lang = initialLang;
    syncBackendLanguagePreference(initialLang);
    i18n.instance.on('languageChanged', handleLang);
    return () => {
      i18n.instance.off('languageChanged', handleLang);
    };
  }, [i18n, initialLang]);

  return { documentDir: 'ltr' as const, i18n, lang };
};
