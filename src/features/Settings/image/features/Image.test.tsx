/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import ImageSettings from './Image';

const setSettingsMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/FormInput', () => ({
  FormSliderWithInput: ({
    disabled,
    onChange,
    value,
  }: {
    disabled?: boolean;
    onChange?: (value: number) => void;
    value?: number;
  }) => (
    <button
      aria-label="default-image-count"
      disabled={disabled}
      type="button"
      onClick={() => onChange?.(6)}
    >
      {value}
    </button>
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

describe('image generation settings', () => {
  it('persists a changed default image count', async () => {
    render(<ImageSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'default-image-count' }));

    await waitFor(() => {
      expect(setSettingsMock).toHaveBeenCalledWith({ image: { defaultImageNum: 6 } });
    });
  });
});
