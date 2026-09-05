import { act, render, screen } from '@testing-library/react';
import type * as ReactModule from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import NavBar from './NavBar';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setShowMarket: (_value: boolean) => {},
  showMarket: false,
  t: (key: string) => key,
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => <span />,
}));

vi.mock('@lobehub/ui/mobile', () => ({
  TabBar: ({
    items,
    safeArea,
  }: {
    items?: { key: string; title: string }[];
    safeArea?: boolean;
  }) => (
    <footer data-safe-area={String(Boolean(safeArea))}>
      {items?.map((item) => (
        <span key={item.key}>{item.title}</span>
      ))}
    </footer>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/hooks/useActiveTabKey', () => ({
  useActiveTabKey: () => 'chat',
}));

vi.mock('@/store/serverConfig', async () => {
  const { useState } = await vi.importActual<typeof ReactModule>('react');

  return {
    featureFlagsSelectors: vi.fn(),
    useServerConfigStore: () => {
      const [showMarket, setShowMarket] = useState(mocks.showMarket);
      mocks.setShowMarket = (value) => {
        mocks.showMarket = value;
        setShowMarket(value);
      };
      return { showMarket };
    },
  };
});

describe('mobile NavBar', () => {
  it('reserves the device bottom safe area', () => {
    expect(renderToStaticMarkup(<NavBar />)).toContain('data-safe-area="true"');
  });

  it('reveals the community button when the server feature flag finishes loading', () => {
    mocks.showMarket = false;
    render(<NavBar />);
    expect(screen.queryByText('tab.community')).not.toBeInTheDocument();

    act(() => mocks.setShowMarket(true));

    expect(screen.getByText('tab.community')).toBeInTheDocument();
  });
});
