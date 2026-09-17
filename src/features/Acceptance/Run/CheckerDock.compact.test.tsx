// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CheckerDock from './CheckerDock';

const openResult = vi.fn();
vi.mock('@/store/chat', () => ({ useChatStore: (s: any) => s({ openVerifyResult: openResult }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/services/verify', () => ({ verifyService: {} }));
vi.mock('../hooks', () => ({
  useVerifyState: () => ({
    data: { verifyStatus: 'passed', verifyPlan: [{ id: 'one', title: 'Image matches', index: 0 }] },
  }),
  useVerifyResults: () => ({
    data: [
      {
        checkItemId: 'one',
        status: 'passed',
        toulmin: { reasoning: 'Lengthy internal verification report' },
      },
    ],
  }),
}));
vi.mock('@/features/Acceptance/components/LocalizedGeneratedText', () => ({
  default: ({ text }: any) => text,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('compact checker evidence', () => {
  it('keeps status rows visible and preserves manual expansion across rerenders', () => {
    const { rerender } = render(<CheckerDock compactDetails embedded operationId="op" />);
    expect(screen.getByText('Image matches')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'groupProcess.details' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(openResult).not.toHaveBeenCalled();
    expect(screen.getByText('Lengthy internal verification report')).toBeTruthy();
    rerender(<CheckerDock compactDetails embedded operationId="op" />);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByText('Image matches'));
    expect(openResult).toHaveBeenCalledWith('op', 'one');
  });
  it('preserves ordinary checker evidence', () => {
    render(<CheckerDock embedded operationId="op" />);
    expect(screen.getByText('Lengthy internal verification report')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'groupProcess.details' })).toBeNull();
  });
});
