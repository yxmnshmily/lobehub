/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import OpenAI from './OpenAI';

const setSettingsMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Select: ({
    disabled,
    onChange,
    options,
    value,
  }: {
    disabled?: boolean;
    onChange?: (value: string) => void;
    options?: Array<{ value: string }>;
    value?: string;
  }) => (
    <select
      aria-label="tts-model"
      disabled={disabled}
      value={value || ''}
      onChange={(event) => onChange?.(event.target.value)}
    >
      <option value="" />
      {options?.map((option) => (
        <option key={option.value} value={option.value}>
          {option.value}
        </option>
      ))}
    </select>
  ),
}));

const initialUserStoreState = useUserStore.getState();

beforeEach(() => {
  setSettingsMock.mockResolvedValue(undefined);
  useUserStore.setState({
    isUserStateInit: true,
    setSettings: setSettingsMock,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  useUserStore.setState(initialUserStoreState, true);
});

describe('OpenAI TTS settings', () => {
  it('persists a selected speech model', async () => {
    render(<OpenAI />);

    fireEvent.change(screen.getByRole('combobox', { name: 'tts-model' }), {
      target: { value: 'tts-1-hd' },
    });

    await waitFor(() => {
      expect(setSettingsMock).toHaveBeenCalledWith({
        tts: { openAI: { ttsModel: 'tts-1-hd' } },
      });
    });
  });
});
