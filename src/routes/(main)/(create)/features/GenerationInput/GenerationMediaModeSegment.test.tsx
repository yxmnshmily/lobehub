/**
 * @vitest-environment happy-dom
 */
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ConfigAction from './ConfigAction';
import GenerationMediaModeSegment from './GenerationMediaModeSegment';

interface SegmentedCapture {
  classNames?: { item?: string; itemLabel?: string };
  onChange?: (value: string) => void;
  options?: Array<{ icon?: ReactNode; label?: ReactNode; value: string }>;
  value?: string;
}

const componentMocks = vi.hoisted(() => ({
  createPage: vi.fn().mockResolvedValue({ id: 'docs_new-page' }),
  navigate: vi.fn(),
  toastError: vi.fn(),
  select: undefined as SegmentedCapture | undefined,
  segmented: undefined as SegmentedCapture | undefined,
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  ActionIcon: ({ title }: { title?: ReactNode }) => (
    <button aria-label={typeof title === 'string' ? title : 'action'} type="button" />
  ),
  Segmented: (props: SegmentedCapture) => {
    componentMocks.segmented = props;
    return (
      <div data-testid="mode-toggle-group">
        {props.options?.map((option) => (
          <span key={option.value}>{option.icon}</span>
        ))}
      </div>
    );
  },
  toast: { error: componentMocks.toastError },
  Select: (props: SegmentedCapture) => {
    componentMocks.select = props;
    return <div data-testid="mode-select" />;
  },
}));

vi.mock('antd-style', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createStaticStyles: () => ({
    heroSelect: 'hero-select',
    heroText: 'hero-text',
    toolbarItem: 'toolbar-item',
    toolbarLabel: 'toolbar-label',
  }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => componentMocks.navigate,
}));

vi.mock('@/store/page', () => ({
  usePageStore: (selector: any) => selector({ createPage: componentMocks.createPage }),
}));

vi.mock('@/features/ChatInput/ActionBar/components/ActionDropdown', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/ChatInput/ActionBar/components/ActionPopover', () => ({
  default: ({ children, content }: { children: ReactNode; content?: ReactNode }) => (
    <div>
      {children}
      {content}
    </div>
  ),
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: <T,>(selector: (state: { isMobile: boolean }) => T) =>
    selector({ isMobile: false }),
}));

describe('GenerationMediaModeSegment', () => {
  it('uses an icon-only toggle group in the composer toolbar', async () => {
    render(<GenerationMediaModeSegment mode="image" />);

    const toggleGroup = screen.getByTestId('mode-toggle-group');
    expect(toggleGroup).toBeInTheDocument();
    expect(screen.queryByTestId('mode-select')).not.toBeInTheDocument();
    expect(toggleGroup.querySelectorAll('svg')).toHaveLength(3);
    expect(screen.queryByText('tab.image')).not.toBeInTheDocument();
    expect(screen.queryByText('tab.video')).not.toBeInTheDocument();
    expect(componentMocks.segmented?.options?.map((option) => option.label)).toEqual([
      'tab.image',
      'tab.video',
      'tab.pages',
    ]);
    expect(componentMocks.segmented?.classNames).toEqual({
      item: 'toolbar-item',
      itemLabel: 'toolbar-label',
    });

    await act(async () => componentMocks.segmented?.onChange?.('video'));
    expect(componentMocks.navigate).toHaveBeenCalledWith('/video');
    await act(async () => componentMocks.segmented?.onChange?.('page'));
    expect(componentMocks.navigate).toHaveBeenCalledWith('/page/new');
  });

  it('keeps the labeled select in the hero title', async () => {
    render(<GenerationMediaModeSegment layout="hero" mode="image" />);

    expect(screen.getByTestId('mode-select')).toBeInTheDocument();
    expect(screen.queryByTestId('mode-toggle-group')).not.toBeInTheDocument();
    await act(async () => componentMocks.select?.onChange?.('page'));
    expect(componentMocks.navigate).toHaveBeenCalledWith('/page/new');
  });
  it.each(['image', 'video', 'page'] as const)(
    'switches from the %s sidebar without recreating the current mode',
    async (mode) => {
      render(<GenerationMediaModeSegment layout="sidebar" mode={mode} />);
      expect(screen.getByTestId('mode-select')).toBeInTheDocument();
      await act(async () => componentMocks.select?.onChange?.(mode));
      expect(componentMocks.createPage).not.toHaveBeenCalled();
      expect(componentMocks.navigate).not.toHaveBeenCalled();
      const target = mode === 'image' ? 'video' : 'image';
      await act(async () => componentMocks.select?.onChange?.(target));
      expect(componentMocks.navigate).toHaveBeenCalledWith(`/${target}`);
      if (mode !== 'page') {
        await act(async () => componentMocks.select?.onChange?.('page'));
        expect(componentMocks.navigate).toHaveBeenCalledWith('/page/new');
      }
    },
  );

  it('does not save blank documents when switching repeatedly', async () => {
    render(<GenerationMediaModeSegment mode="video" />);
    await act(async () => componentMocks.segmented?.onChange?.('page'));
    await act(async () => componentMocks.segmented?.onChange?.('page'));
    expect(componentMocks.createPage).not.toHaveBeenCalled();
    expect(componentMocks.navigate).toHaveBeenCalledWith('/page/new');
  });
});

describe('generation toolbar actions', () => {
  it('renders without a ChatInputProvider', () => {
    render(<ConfigAction content={<span>config-content</span>} title="config-title" />);

    expect(screen.getByRole('button', { name: 'config-title' })).toBeInTheDocument();
    expect(screen.getByText('config-content')).toBeInTheDocument();
  });
});
