import i18n, { type TFunction } from 'i18next';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

type Values = Record<string, unknown>;

const translate = (t: TFunction, source: string, values?: Values): string =>
  t(`travelUi.${source}`, {
    ...values,
    defaultValue: source,
    keySeparator: false,
    ns: 'common',
    nsSeparator: false,
  });

/** Resolve labels at render/action time, including labels in shared lookup tables. */
export const translateTravel = (source: string, values?: Values): string =>
  translate(i18n.t.bind(i18n), source, values);

/** Subscribe memoized components and callbacks to language changes. */
export const useTravelTranslation = () => {
  const { t } = useTranslation('common');
  return useCallback((source: string, values?: Values) => translate(t, source, values), [t]);
};

export const getTravelLocale = () => i18n.resolvedLanguage || i18n.language || 'en-US';
