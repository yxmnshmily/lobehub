// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GroupProcessDetails from './GroupProcessDetails';

let groupId: string | undefined;
vi.mock('../../store', () => ({
  useConversationStore: (selector: any) => selector({ context: { groupId } }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

describe('GroupProcessDetails', () => {
  it('keeps non-group content directly available', () => {
    groupId = undefined;
    render(<GroupProcessDetails>Internal details</GroupProcessDetails>);
    expect(screen.getByText('Internal details')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('allows group details to be expanded and collapsed', () => {
    groupId = 'group';
    render(<GroupProcessDetails>Internal details</GroupProcessDetails>);
    const trigger = screen.getByRole('button', { name: 'groupProcess.details' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Internal details')).toBeTruthy();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
