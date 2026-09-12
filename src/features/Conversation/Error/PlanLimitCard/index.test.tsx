import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

import PlanLimitCard from './index';

const locale = vi.hoisted(() => ({ language: 'zh-CN' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: locale, t: (key: string) => key }),
}));
vi.mock('../style', () => ({
  ErrorActionContainer: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  FormAction: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

it.each([
  ['zh-CN', 5_847_518, '584.7518万'],
  ['zh-CN', 120_000_000, '1.2亿'],
  ['zh-CN', 500, '500'],
  ['en-US', 2_500_000, '2.50M'],
] as const)(
  'displays required credits without changing their value (%s, %s)',
  (language, amount, expected) => {
    locale.language = language;
    render(
      <PlanLimitCard errorBody={{ budget: { requiredCredits: amount } }} onRetry={() => {}} />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
  },
);
