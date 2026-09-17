/**
 * @vitest-environment happy-dom
 */
import type * as BaseUI from '@lobehub/ui/base-ui';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ConversationFrame from '@/features/SuperGroup/ConversationFrame';

import ShareButton from './index';

const mocks = vi.hoisted(() => ({
  activeTopicId: 'topic-1' as string | undefined,
  enableBusinessFeatures: true,
  permission: {
    allowed: true,
    reason: 'requires member',
  },
  modal: vi.fn(),
  messages: [
    {
      id: 'old-message',
      topicId: 'old-topic',
      groupId: 'group-1',
      role: 'user',
      content: '昨天的行程',
    },
    {
      id: 'new-message',
      topicId: 'topic-1',
      groupId: 'group-1',
      role: 'user',
      content: '今天的行程',
    },
  ],
}));

const actionIconPropsSpy = vi.hoisted(() => vi.fn());
const sharePropsSpy = vi.hoisted(() => vi.fn());
const exportSpy = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof BaseUI>();
  return {
    ...actual,
    createModal: mocks.modal,
    useModalContext: () => ({ close: vi.fn() }),
    ActionIcon: (props: ComponentProps<typeof actual.ActionIcon>) => {
      actionIconPropsSpy(props);
      return <actual.ActionIcon {...props} />;
    },
  };
});

vi.mock('@/features/SharePopover', () => ({
  SharePopoverContent: (props: any) => {
    sharePropsSpy(props);
    return <p>{props.topicTitle}</p>;
  },
}));
vi.mock('@/features/GroupMembership/GroupShareButton', () => ({
  GroupLinkPanel: () => <p>invitation link</p>,
}));
vi.mock('@/services/topic', () => ({
  topicService: { getTopicDetail: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@/features/ShareModal', () => ({
  openShareModal: exportSpy,
  useShareModal: () => ({
    openShareModal: vi.fn(),
  }),
}));

vi.mock('../../useGroupConversationMessages', () => ({
  useGroupConversationMessages: () => mocks.messages,
}));
vi.mock('@/store/chat', () => ({ useChatStore: { getState: () => ({}) } }));
vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => () => ({
      title: id === 'old-topic' ? '昨天的话题' : '今天的话题',
    }),
  },
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.permission.allowed, reason: mocks.permission.reason }),
}));

vi.mock('../../useGroupContext', () => ({
  useGroupContext: () => ({
    agentId: 'supervisor-1',
    groupId: 'group-1',
    topicId: mocks.activeTopicId,
  }),
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (
    selector: (state: { serverConfig: { enableBusinessFeatures: boolean } }) => unknown,
  ) => selector({ serverConfig: { enableBusinessFeatures: mocks.enableBusinessFeatures } }),
}));

vi.mock('@/store/serverConfig/selectors', () => ({
  serverConfigSelectors: {
    enableBusinessFeatures: (s: { serverConfig: { enableBusinessFeatures: boolean } }) =>
      s.serverConfig.enableBusinessFeatures,
  },
}));

describe('Group Conversation ShareButton', () => {
  it('keeps one share action and opens group files from the document action', async () => {
    render(<ShareButton />);
    expect(screen.getByRole('button', { name: 'groupInvitation.share' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '群文件' }));
    expect(exportSpy).toHaveBeenCalledWith({
      context: expect.objectContaining({ groupId: 'group-1' }),
      title: '群文件',
    });
    expect(screen.queryByRole('button', { name: '分享聊天记录' })).toBeNull();
  });
  it('keeps group link sharing available before any topic is created', () => {
    mocks.activeTopicId = undefined;
    render(<ShareButton />);
    expect(screen.getByRole('button', { name: 'groupInvitation.share' })).toBeInTheDocument();
  });
  beforeEach(() => {
    mocks.activeTopicId = 'topic-1';
    mocks.enableBusinessFeatures = true;
    mocks.permission.allowed = true;
    mocks.modal.mockReset();
    mocks.modal.mockImplementation(({ content }) => {
      const mounted = render(content);
      return { close: mounted.unmount };
    });
    exportSpy.mockClear();
    actionIconPropsSpy.mockClear();
    sharePropsSpy.mockClear();
  });

  it.each([false, true])('offers a topic link on self-hosted groups (mobile=%s)', (mobile) => {
    mocks.enableBusinessFeatures = false;
    render(<ShareButton mobile={mobile} />);
    fireEvent.click(screen.getByRole('button', { name: 'groupInvitation.share' }));
    expect(screen.getByRole('tab', { name: 'shareModal.popover.title' })).toBeEnabled();
  });

  it('shares the visible historical topic, freezes it while open, then resolves again on reopen', async () => {
    const { container, rerender } = render(
      <div data-conversation-frame>
        <ShareButton />
        <div data-conversation-viewport>
          <div data-share-topic-id="old-topic" />
          <div data-share-topic-id="topic-1" />
        </div>
      </div>,
    );
    const viewport = container.querySelector('[data-conversation-viewport]')!;
    const rows = container.querySelectorAll('[data-share-topic-id]');
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 500,
      height: 400,
      width: 600,
    } as DOMRect);
    const oldRect = vi
      .spyOn(rows[0], 'getBoundingClientRect')
      .mockReturnValue({ top: 80, bottom: 350, height: 270, width: 600 } as DOMRect);
    const newRect = vi
      .spyOn(rows[1], 'getBoundingClientRect')
      .mockReturnValue({ top: 350, bottom: 650, height: 300, width: 600 } as DOMRect);
    fireEvent.click(screen.getByRole('button', { name: 'groupInvitation.share' }));
    fireEvent.click(screen.getAllByRole('tab', { name: 'shareModal.popover.title' }).at(-1)!);
    expect(sharePropsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ topicId: 'old-topic', topicTitle: '昨天的话题' }),
    );
    await sharePropsSpy.mock.lastCall![0].onOpenModal();
    expect(exportSpy).toHaveBeenCalledWith({
      snapshot: expect.objectContaining({
        context: expect.objectContaining({ topicId: 'old-topic' }),
        messages: [expect.objectContaining({ id: 'old-message' })],
        title: '昨天的话题',
      }),
    });
    oldRect.mockReturnValue({ top: -400, bottom: 0, height: 400, width: 600 } as DOMRect);
    newRect.mockReturnValue({ top: 100, bottom: 600, height: 500, width: 600 } as DOMRect);
    rerender(
      <div data-conversation-frame>
        <ShareButton />
        <div data-conversation-viewport>
          <div data-share-topic-id="old-topic" />
          <div data-share-topic-id="topic-1" />
        </div>
      </div>,
    );
    expect(sharePropsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ topicId: 'old-topic' }),
    );
    mocks.modal.mock.results[0].value.close();
    fireEvent.click(screen.getByRole('button', { name: 'groupInvitation.share' }));
    fireEvent.click(screen.getByRole('tab', { name: 'shareModal.popover.title' }));
    expect(sharePropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({ topicId: 'topic-1' }));
  });

  it('resolves the visible topic when the mobile shortcut is rendered in a portal', () => {
    const { container } = render(
      <ConversationFrame header={createPortal(<ShareButton mobile />, document.body)}>
        <div data-conversation-viewport>
          <div data-share-topic-id="old-topic" />
        </div>
      </ConversationFrame>,
    );
    for (const element of container.querySelectorAll(
      '[data-conversation-viewport], [data-share-topic-id]',
    )) {
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 500,
        height: 400,
        width: 600,
      } as DOMRect);
    }
    fireEvent.click(screen.getByRole('button', { name: 'groupInvitation.share' }));
    fireEvent.click(screen.getByRole('tab', { name: 'shareModal.popover.title' }));
    expect(sharePropsSpy).toHaveBeenCalledWith(expect.objectContaining({ topicId: 'old-topic' }));
  });

  it('does not open share popover for workspace viewers', () => {
    mocks.permission.allowed = false;

    const { queryByTestId } = render(<ShareButton />);

    expect(actionIconPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        disabled: true,
        title: 'requires member',
      }),
    );
    expect(screen.getByRole('button', { name: '群文件' })).toBeDisabled();
    expect(queryByTestId('share-popover')).toBeNull();
  });
});
