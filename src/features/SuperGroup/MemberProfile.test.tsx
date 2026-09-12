import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import MemberProfile from './MemberProfile';

vi.mock('@lobehub/editor/react', () => ({ useEditor: () => ({}) }));
vi.mock('@/features/EditorCanvas', () => ({
  EditorCanvas: ({ editor, editable, editorData }: any) =>
    editor && <article aria-readonly={!editable}>{editorData.content}</article>,
}));
vi.mock('@/features/ModelSelect', () => ({
  default: ({ value, disabled }: any) => <button disabled={disabled}>{value.model}</button>,
}));
vi.mock('./JoinedGroupSidebar', () => ({ default: () => null, SuperGroupSidebarBody: () => null }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: any) => selector({ isMobile: false }),
}));
vi.mock('@/routes/(main)/group/profile/features/Header', () => ({
  ProfileHeaderBar: ({ items, onChange }: any) => (
    <nav>
      {items.map((item: any) => (
        <button key={item.id} onClick={() => onChange(item.id)}>
          {item.title}
        </button>
      ))}
    </nav>
  ),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupMembership: {
      listParticipants: {
        useQuery: () => ({
          data: {
            assistants: [
              {
                id: 'assistant',
                title: '旅行规划',
                subtitle: '旅行规划师',
                description: '为群组规划旅行路线',
                avatar: null,
                model: 'group-model',
                provider: 'provider',
                isSupervisor: false,
              },
            ],
          },
          dataUpdatedAt: 1,
          isLoading: false,
          isError: false,
        }),
      },
    },
  },
}));

describe('member adapter for the administrator profile surface', () => {
  it('switches profiles with read-only content and the authoritative model', () => {
    render(
      <MemoryRouter initialEntries={['/group/joined/profile']}>
        <MemberProfile
          group={{
            groupId: 'joined',
            title: '超级工作群',
            avatar: null,
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '超级工作群' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '旅行规划' }));
    expect(screen.getByRole('heading', { name: '旅行规划' })).toBeVisible();
    expect(screen.getByText('旅行规划师')).toBeVisible();
    expect(screen.getByRole('article')).toHaveTextContent('为群组规划旅行路线');
    expect(screen.getByRole('article')).toHaveAttribute('aria-readonly', 'true');
    expect(screen.getByRole('button', { name: 'group-model' })).toBeDisabled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
