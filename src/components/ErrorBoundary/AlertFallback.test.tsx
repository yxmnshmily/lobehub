import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import en from '../../../locales/en-US/common.json';
import zh from '../../../locales/zh-CN/common.json';
import AlertFallback from './AlertFallback';

const locale = vi.hoisted(() => ({ language: 'zh' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (locale.language === 'zh' ? zh : en)[key as keyof typeof zh],
  }),
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({
    title,
    message,
    text,
    extra,
  }: {
    title: string;
    message: string;
    text: { detail: string };
    extra: ReactNode;
  }) => (
    <section>
      {title}
      <p>{message}</p>
      <details>
        <summary>{text.detail}</summary>
        {extra}
      </details>
    </section>
  ),
}));
vi.mock('@lobehub/ui/es/Highlighter/index', () => ({
  default: ({ children }: { children: ReactNode }) => <pre>{children}</pre>,
}));
afterEach(cleanup);

it('localizes the error heading and details control while retaining the diagnostic', async () => {
  locale.language = 'zh';
  render(<AlertFallback error={new Error('Lexical diagnostic')} resetErrorBoundary={() => {}} />);
  expect(screen.getByText('内容暂时无法显示')).toBeTruthy();
  expect(screen.getByText('查看错误详情')).toBeTruthy();
  expect(await screen.findByText(/Error: Lexical diagnostic/)).toBeTruthy();
  expect(screen.queryByText('Show Details')).toBeNull();
});

it('uses English labels when English is selected', () => {
  locale.language = 'en';
  render(<AlertFallback error={new Error('Diagnostic')} resetErrorBoundary={() => {}} />);
  expect(screen.getByText('Unable to display this content')).toBeTruthy();
  expect(screen.getByText('View error details')).toBeTruthy();
});
