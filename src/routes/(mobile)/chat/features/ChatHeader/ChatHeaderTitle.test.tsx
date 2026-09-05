import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ChatHeaderTitle from './ChatHeaderTitle';

const toggleMobileTopic = vi.fn();

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({
    align: _align,
    as: Component = 'div',
    children,
    gap: _gap,
    horizontal: _horizontal,
    ...rest
  }: any) => <Component {...rest}>{children}</Component>,
  Icon: () => <span />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: (props: any) => <button type="button" {...props} />,
}));

vi.mock('@lobehub/ui/mobile', () => ({
  ChatHeader: {
    Title: ({ desc, title }: { desc?: React.ReactNode; title?: React.ReactNode }) => (
      <header>
        {title}
        {desc}
      </header>
    ),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `topic.${key}` }),
}));

vi.mock('@/hooks/useFetchActiveTopicDetail', () => ({ useFetchActiveTopicDetail: vi.fn() }));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { currentAgentDisplayName: () => 'Agent' },
  builtinAgentSelectors: { isInboxAgent: () => false },
}));
vi.mock('@/store/agent', () => ({ useAgentStore: (selector: any) => selector({}) }));
vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    currentActiveTopic: () => ({ title: 'Topic A' }),
    currentTopicCount: () => 1,
  },
}));
vi.mock('@/store/chat', () => ({ useChatStore: (selector: any) => selector({}) }));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: any) => selector({ toggleMobileTopic }),
}));

describe('ChatHeaderTitle', () => {
  it('exposes both topic toggles as named buttons', () => {
    render(<ChatHeaderTitle />);

    const toggles = screen.getAllByRole('button', { name: 'topic.title' });
    expect(toggles).toHaveLength(2);

    fireEvent.click(toggles[0]);
    fireEvent.click(toggles[1]);
    expect(toggleMobileTopic).toHaveBeenCalledTimes(2);
  });
});
