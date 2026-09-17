// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Tool from './index';

let groupId: string | undefined;
let toolMessage: any;
vi.mock('../../../store', () => ({
  dataSelectors: { getDbMessageByToolCallId: () => () => toolMessage },
  messageStateSelectors: { isToolCallStreaming: () => () => false },
  useConversationStore: (selector: any) => selector({ context: { groupId } }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobechat/builtin-tools/renders', () => ({ getBuiltinRender: () => undefined }));
vi.mock('@/libs/next/dynamic', () => ({
  default:
    () =>
    ({ result }: any) => <div>{result?.content || 'Complete tool result'}</div>,
}));
vi.mock('../../AssistantGroup/Tool/Inspector', () => ({ default: () => <span>Tool status</span> }));
vi.mock('@/features/Conversation/Messages/AssistantGroup/Tool/Actions', () => ({
  default: () => <button>Tool actions</button>,
}));
const props = {
  apiName: 'search',
  identifier: 'lobe-web-browsing',
  index: 0,
  messageId: 'message',
  toolCallId: 'call',
};
afterEach(cleanup);
beforeEach(() => {
  groupId = 'group';
  toolMessage = { content: 'Complete tool result' };
});
describe('orphan tool process', () => {
  it('folds only group process and preserves its expanded state on updates', () => {
    const { rerender } = render(<Tool {...props} />);
    expect(screen.getByText('Tool status')).toBeTruthy();
    expect(screen.getByText('Tool actions')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'groupProcess.details' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    rerender(<Tool {...props} />);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Complete tool result')).toBeTruthy();
  });
  it('preserves non-group results', () => {
    groupId = undefined;
    render(<Tool {...props} />);
    expect(screen.getByText('Complete tool result')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'groupProcess.details' })).toBeNull();
  });
  it.each(['image', 'document'])('keeps %s visible', (kind) => {
    if (kind === 'image') toolMessage.pluginState = { images: [{ url: '/image.png' }] };
    render(
      <Tool
        {...props}
        {...(kind === 'document'
          ? {
              identifier: 'lobe-agent-documents',
              apiName: 'createDocument',
              arguments: '{"title":"Result"}',
            }
          : {})}
      />,
    );
    expect(screen.getByText('Complete tool result')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'groupProcess.details' })).toBeNull();
  });
  it.each([false, true])('folds raw failures even with image state: %s', (withImage) => {
    toolMessage = {
      content: 'RAW_STACK_AND_ARGUMENTS',
      error: { message: 'internal trace' },
      pluginState: withImage ? { images: [{ url: '/image.png' }] } : undefined,
    };
    render(<Tool {...props} />);
    expect(screen.getByText('operationFailed')).toBeTruthy();
    expect(screen.getByText('Tool status')).toBeTruthy();
    expect(screen.queryByText('RAW_STACK_AND_ARGUMENTS')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'groupProcess.details' }));
    expect(screen.getByText('RAW_STACK_AND_ARGUMENTS')).toBeTruthy();
  });
});
