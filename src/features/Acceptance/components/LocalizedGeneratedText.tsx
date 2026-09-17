import { chainTranslate } from '@lobechat/prompts';
import { merge } from '@lobechat/utils';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/libs/better-auth/auth-client';
import { chatService } from '@/services/chat';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

// Display translations only; original verification records remain untouched.
const translations = new Map<string, Promise<string>>();
export const needsDisplayTranslation = (text: string, english: boolean) => {
  const chinese = (text.match(/[\u3400-\u9FFF]/g) || []).length;
  const words = (text.match(/[A-Z]{3,}/gi) || []).length;
  return english ? chinese > 0 : words > 5 && words > chinese;
};

export default function LocalizedGeneratedText({
  text,
  children,
}: {
  text: string;
  children?: (value: string) => ReactNode;
}) {
  const { i18n } = useTranslation();
  const { data: session } = useSession();
  const english = /^en(?:-|$)/i.test(i18n.resolvedLanguage || i18n.language);
  const locale = english ? 'en-US' : 'zh-CN';
  const key = JSON.stringify([session?.user?.id, locale, text]);
  const [result, setResult] = useState<{ key: string; text?: string; error?: boolean }>();
  const needed = needsDisplayTranslation(text, english);
  useEffect(() => {
    if (!needed || !session?.user) return;
    let active = true;
    let promise = translations.get(key);
    if (!promise) {
      promise = new Promise<string>((resolve, reject) => {
        const settings = systemAgentSelectors.translation(useUserStore.getState());
        void chatService.fetchPresetTaskResult({
          params: merge(settings, chainTranslate(text, locale)),
          onFinish: async (value) =>
            value.trim() ? resolve(value) : reject(new Error('Empty translation')),
          onError: reject,
        });
      });
      if (translations.size >= 100) translations.delete(translations.keys().next().value!);
      translations.set(key, promise);
    }
    promise
      .then((value) => {
        if (active) setResult({ key, text: value });
      })
      .catch(() => {
        translations.delete(key);
        if (active) setResult({ key, error: true });
      });
    return () => {
      active = false;
    };
  }, [key, locale, needed, session?.user?.id, text]);
  if (!needed || !session?.user) return children ? children(text) : text;
  if (result?.key === key && result.text) return children ? children(result.text) : result.text;
  if (result?.key === key && result.error)
    return (
      <span>
        {english ? 'Translation unavailable. Original: ' : '翻译暂时失败，原文：'}
        {children ? children(text) : text}
      </span>
    );
  return <span aria-busy="true">{english ? 'Translating…' : '正在翻译为中文…'}</span>;
}
