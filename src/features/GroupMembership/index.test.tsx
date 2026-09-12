import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { GroupMembersButton } from './index';

const openModal = vi.hoisted(() => vi.fn());
vi.mock('@lobehub/ui/base-ui', () => ({
  createModal: openModal,
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  ActionIcon: ({ title, onClick }: any) => <button onClick={onClick}>{title}</button>,
}));
vi.mock('./MemberPanel', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_: string, options: any) => options.defaultValue }),
}));

it('opens the current group full member panel from More, preserving management scope', () => {
  render(<GroupMembersButton manageDefaultGroup showLabel groupId="current-group" />);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(openModal).toHaveBeenCalledOnce();
  expect(openModal.mock.calls[0][0].content.props).toEqual({
    groupId: 'current-group',
    manageDefaultGroup: true,
  });
});
