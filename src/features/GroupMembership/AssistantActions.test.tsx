import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AssistantActions from './AssistantActions';

const mocks = vi.hoisted(() => ({
  admin: true,
  confirm: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  updated: vi.fn(),
}));
vi.mock('@lobehub/ui', () => ({ Flexbox: ({ children }: any) => <div>{children}</div> }));
vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: mocks.confirm,
  toast: { error: vi.fn() },
}));
vi.mock('./AssistantMenu', () => ({
  default: ({ canConfigure, onRemove, title }: any) => (
    <>
      <button aria-label={`more ${title}`}>more</button>
      {canConfigure && onRemove && (
        <button aria-label={`delete ${title}`} onClick={onRemove}>
          delete
        </button>
      )}
    </>
  ),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    platformAccess: { isPlatformAdmin: { useQuery: () => ({ data: mocks.admin }) } },
    platformOperations: {
      removeSuperGroupTemplateMember: { useMutation: () => ({ mutateAsync: mocks.remove }) },
    },
  },
}));
vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: Object.assign(
    (selector: any) =>
      selector({
        groupMap: {
          group: { config: { memberSlots: [{ agentId: 'writer', key: 'copywriter' }] } },
        },
      }),
    { getState: () => ({ refreshGroupDetail: mocks.refresh }) },
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.admin = true;
});
const mount = (isSupervisor = false) =>
  render(
    <MemoryRouter basename="/lobehub" initialEntries={['/lobehub/group/group']}>
      <AssistantActions
        agentId="writer"
        groupId="group"
        isSupervisor={isSupervisor}
        title="Writer"
        onUpdated={mocks.updated}
      />
    </MemoryRouter>,
  );
describe('assistant row actions', () => {
  it('offers the complete member operations menu', () => {
    mount();
    expect(screen.getByRole('button', { name: 'more Writer' })).toBeVisible();
  });
  it('links to the actual member profile and deletes the matched template slot after confirmation', async () => {
    mount();
    expect(screen.getByRole('link', { name: 'edit Writer' })).toHaveAttribute(
      'href',
      '/lobehub/agent/writer/profile',
    );
    fireEvent.click(screen.getByRole('button', { name: 'delete Writer' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    await act(mocks.confirm.mock.calls[0][0].onOk);
    expect(mocks.remove).toHaveBeenCalledWith({ key: 'copywriter' });
    expect(mocks.refresh).toHaveBeenCalledWith('group');
    expect(mocks.updated).toHaveBeenCalled();
  });
  it('does not offer deletion for the supervisor', () => {
    mount(true);
    expect(screen.queryByRole('button', { name: 'delete Writer' })).toBeNull();
  });
  it('does not offer management to non-admin users', () => {
    mocks.admin = false;
    mount();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: 'delete Writer' })).toBeNull();
    expect(screen.getByRole('button', { name: 'more Writer' })).toBeVisible();
  });
});
