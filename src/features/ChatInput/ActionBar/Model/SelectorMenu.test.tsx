// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SelectorMenu from './SelectorMenu';

vi.mock('@/components/LobeIcons', () => ({ ModelIcon: () => null }));
vi.mock(
  '@/features/ModelSwitchPanel',
  async () => await import('@/features/ModelSwitchPanel/SubmenuPopup'),
);
vi.mock('@/features/ModelSwitchPanel/components/PanelContent', () => ({
  PanelContent: ({ onModelChange, onOpenChange }: any) => (
    <button
      onClick={() => {
        onModelChange({ model: 'other', provider: 'test' });
        onOpenChange(false);
      }}
    >
      Other model
    </button>
  ),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
describe('model submenu', () => {
  it('opens on click and commits a selected model', async () => {
    const change = vi.fn().mockResolvedValue(undefined);
    render(
      <SelectorMenu
        canSelectModel
        displayName="DeepSeek"
        effort={{ effortLevels: [], modeLevels: [], select: vi.fn() } as any}
        model="deepseek"
        provider="test"
        onModelChange={change}
      >
        <button>Choose model</button>
      </SelectorMenu>,
    );
    fireEvent.click(screen.getByText('Choose model'));
    fireEvent.pointerDown(await screen.findByText('modelSelector.model'), { pointerType: 'mouse' });
    fireEvent.mouseDown(await screen.findByText('modelSelector.model'), { button: 0 });
    fireEvent.click(await screen.findByText('Other model'));
    expect(change).toHaveBeenCalledWith({ model: 'other', provider: 'test' });
    await waitFor(() => expect(screen.queryByText('Other model')).toBeNull());
  });
});
