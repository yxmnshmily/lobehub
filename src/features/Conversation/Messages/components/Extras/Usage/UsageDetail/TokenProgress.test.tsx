import { act, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { expect, it, vi } from 'vitest';

import TokenProgress from './TokenProgress';

vi.unmock('react-i18next');

it.each([true, false])(
  'localizes credit/token rows on language changes (credit=%s)',
  async (isCredit) => {
    const i18n = createInstance();
    await i18n.init({ lng: 'zh-CN', resources: {} });
    render(
      <I18nextProvider i18n={i18n}>
        <TokenProgress
          isCredit={isCredit}
          data={[
            { id: 'input', title: 'Input', value: 8700, color: 'green' },
            { id: 'total', title: 'Total', value: 12000, color: 'blue' },
          ]}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText('8700')).toBeVisible();
    expect(screen.getByText('1.2万')).toBeVisible();
    await act(() => i18n.changeLanguage('en-US'));
    expect(screen.getByText('8.7K')).toBeVisible();
    expect(screen.getByText('12K')).toBeVisible();
  },
);
