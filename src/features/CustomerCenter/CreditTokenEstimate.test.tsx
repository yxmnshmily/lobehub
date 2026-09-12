import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import CreditTokenEstimate from './AvailableTokenEstimate';

const runtime = vi.hoisted(() => ({ deepseek: false }));
vi.mock('./useMonthlyExchangeRate', () => ({
  useMonthlyExchangeRate: () => ({ quote: { rate: 7 }, stale: false, notice: 'Latest FX' }),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-US' } }) }));
vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: any) =>
    selector({
      useFetchAiProviderRuntimeState: () => ({
        data: {
          enabledChatModelList: [
            {
              id: runtime.deepseek ? 'deepseek' : 'alternate',
              name: 'Alternate provider',
              children: [
                {
                  id: 'model-4',
                  displayName: 'Model 4',
                  pricing: {
                    currency: 'USD',
                    units: [
                      { name: 'textInput', strategy: 'fixed', unit: 'millionTokens', rate: 8 },
                      { name: 'textOutput', strategy: 'fixed', unit: 'millionTokens', rate: 16 },
                    ],
                  },
                },
              ],
            },
            {
              id: 'test',
              name: 'Test provider',
              children: [2, 4].map((rate) => ({
                id: `model-${rate}`,
                displayName: `Model ${rate}`,
                pricing: {
                  currency: 'USD',
                  units: [
                    { name: 'textInput', strategy: 'fixed', unit: 'millionTokens', rate },
                    {
                      name: 'textOutput',
                      strategy: 'fixed',
                      unit: 'millionTokens',
                      rate: rate * 2,
                    },
                  ],
                },
              })),
            },
          ].reverse(),
        },
      }),
    }),
}));
afterEach(() => {
  cleanup();
  runtime.deepseek = false;
});

it('defaults to enabled DeepSeek ahead of the recent model without overriding manual selection', () => {
  runtime.deepseek = true;
  const { rerender } = render(<CreditTokenEstimate credits={1_000_000} preferredModel="model-2" />);
  const provider = screen.getByRole('combobox', { name: 'Provider' });
  expect(provider).toHaveValue('deepseek');
  expect(screen.getByRole('combobox', { name: 'Estimate model' })).toHaveValue('model-4');
  expect(screen.getByText('≈ Available input 125K Token')).toBeTruthy();
  fireEvent.change(provider, { target: { value: 'test' } });
  rerender(<CreditTokenEstimate credits={1_000_000} preferredModel="model-2" />);
  expect(provider).toHaveValue('test');
});

it('defaults to the recent model and updates the separate input/output estimates when switched', () => {
  render(<CreditTokenEstimate credits={1_000_000} preferredModel="model-4" />);
  expect(screen.getByText('≈ Available input 250K Token')).toBeTruthy();
  expect(screen.getByText('Or available output 125K Token')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: 'Estimate model' }), {
    target: { value: 'model-2' },
  });
  expect(screen.getByText('≈ Available input 500K Token')).toBeTruthy();
  expect(screen.getByText('Or available output 250K Token')).toBeTruthy();
});

it('selects provider first and limits models to that provider while keeping its price', () => {
  render(<CreditTokenEstimate credits={1_000_000} preferredModel="model-4" />);
  const model = screen.getByRole('combobox', { name: 'Estimate model' });
  expect(within(model).getAllByRole('option')).toHaveLength(2);
  const provider = screen.getByRole('combobox', { name: 'Provider' });
  expect(screen.getAllByRole('combobox')[0]).toBe(provider);
  expect(within(provider).getAllByRole('option')).toHaveLength(2);
  fireEvent.change(provider, { target: { value: 'alternate' } });
  expect(screen.getByText('≈ Available input 125K Token')).toBeTruthy();
  expect(screen.getByText('Or available output 62.5K Token')).toBeTruthy();
  expect(within(model).getAllByRole('option')).toHaveLength(1);
  expect(within(model).queryByRole('option', { name: 'Model 2' })).toBeNull();
  fireEvent.change(provider, { target: { value: 'test' } });
  fireEvent.change(model, { target: { value: 'model-2' } });
  expect(screen.getByText('≈ Available input 500K Token')).toBeTruthy();
  fireEvent.change(provider, { target: { value: 'alternate' } });
  expect(model).toHaveValue('model-4');
  expect(provider).toHaveValue('alternate');
  expect(screen.getByText('≈ Available input 125K Token')).toBeTruthy();
});

it('does not turn an unavailable balance into a zero-token allowance', () => {
  render(<CreditTokenEstimate />);
  expect(screen.getByText('≈ Available input — Token')).toBeTruthy();
  expect(screen.getByText('Or available output — Token')).toBeTruthy();
});
