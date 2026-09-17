// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import zhChat from '../../../../../locales/zh-CN/chat.json';
import ModelSwitch from './index';

const state = vi.hoisted(() => ({
  activeTopicId: 'group-topic',
  isGroupContext: false,
  topicDataMap: {},
  topicDetailMap: {} as Record<string, any>,
  useFetchTopicDetail: vi.fn(),
  updateTopicModel: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (zhChat as Record<string, string>)[key] ?? key }),
}));
vi.mock('@/store/chat', () => ({ useChatStore: (selector: any) => selector(state) }));
vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: () => undefined,
  aiModelSelectors: { getEnabledModelById: () => () => undefined },
}));
vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => 'supervisor' }));
vi.mock('../../hooks/useAgentModelSelection', () => ({
  useAgentModelSelection: () => ({
    canDisplayModel: true,
    canSelectModel: true,
    isGroupContext: state.isGroupContext,
    model: 'deepseek',
    provider: 'deepseek',
    selectModel: vi.fn(),
  }),
}));
vi.mock('../../hooks/useModelLockTooltip', () => ({ useModelLockTooltip: () => undefined }));
vi.mock('../../hooks/useReasoningEffortControl', () => ({
  useReasoningEffortControl: () => ({ hasReasoningParams: false }),
}));
vi.mock('../context', () => ({ useActionBarContext: () => ({}) }));
vi.mock('../../components/SelectorTrigger', () => ({
  default: ({ text, title, ariaLabel }: any) => (
    <button aria-label={ariaLabel} title={title}>
      {text}
    </button>
  ),
}));
vi.mock('@/features/ModelSwitchPanel', () => ({ default: ({ children }: any) => children }));
it('loads the saved topic model when the group topic list is not mounted', () => {
  const view = render(<ModelSwitch />);
  expect(state.useFetchTopicDetail).toHaveBeenCalledWith('group-topic');
  state.topicDetailMap['group-topic'] = {
    id: 'group-topic',
    model: 'gpt-6-astra',
    provider: 'openai',
  };
  view.rerender(<ModelSwitch key="loaded" />);
  expect(screen.getByText('gpt-6-astra')).toBeVisible();
  expect(screen.queryByText('deepseek')).toBeNull();
  expect(state.useFetchTopicDetail).toHaveBeenLastCalledWith(undefined);
});

it('names the supervisor and explains topic scope without changing the saved model', () => {
  state.isGroupContext = true;
  const view = render(<ModelSwitch />);
  expect(screen.getByRole('button', { name: '群主管模型：gpt-6-astra' })).toHaveAttribute(
    'title',
    zhChat['modelSelector.supervisorTopicHint'],
  );
  view.unmount();
  state.isGroupContext = false;
});
