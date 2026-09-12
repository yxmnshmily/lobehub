import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TopicList from './TopicList';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openNewGenerationTopic: vi.fn(),
  pathname: '/page',
  setNewGenerationTopicVisibility: vi.fn(),
  useFetchGenerationTopics: vi.fn(),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: mocks.pathname }),
}));
vi.mock('@/store/user', () => ({ useUserStore: () => true }));
vi.mock('./Item', () => ({ default: () => null }));
vi.mock('./StoreContext', () => ({
  useGenerationTopicContext: () => ({
    namespace: 'image',
    useStore: (selector: any) => selector({ ...mocks, generationTopics: [] }),
  }),
}));

describe('Generation topic empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = '/page';
  });

  it('opens the generation page from documents while preserving visibility', () => {
    render(<TopicList visibility="private" />);
    fireEvent.click(screen.getByText('topic.createNew'));
    expect(mocks.setNewGenerationTopicVisibility).toHaveBeenCalledWith('private');
    expect(mocks.openNewGenerationTopic).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith('/image');
  });

  it('keeps existing generation-page topic creation in place', () => {
    mocks.pathname = '/workspace/workspace-1/image';
    render(<TopicList visibility="public" />);
    fireEvent.click(screen.getByText('topic.createNew'));
    expect(mocks.setNewGenerationTopicVisibility).toHaveBeenCalledWith('public');
    expect(mocks.openNewGenerationTopic).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
