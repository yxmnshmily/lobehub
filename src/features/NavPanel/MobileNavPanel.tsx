'use client';

import { ActionIcon, Drawer } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { X } from 'lucide-react';
import {
  createContext,
  memo,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveLocation } from '@/hooks/useActiveLocation';

import { getNavPanelRegistrySnapshot, subscribeNavPanelRegistry } from './registry';
import { useActiveNavKey } from './useActiveNavKey';

interface MobileNavPanelController {
  close: () => void;
  open: boolean;
  toggle: () => void;
}

const MobileNavPanelContext = createContext<MobileNavPanelController | null>(null);

export const useMobileNavPanelController = () => use(MobileNavPanelContext);

const MobileNavPanelDrawer = memo<Pick<MobileNavPanelController, 'close' | 'open'>>(
  ({ close, open }) => {
    const { t } = useTranslation('common');
    const activeNavKey = useActiveNavKey();
    const registry = useSyncExternalStore(
      subscribeNavPanelRegistry,
      getNavPanelRegistrySnapshot,
      getNavPanelRegistrySnapshot,
    );
    const entry = registry.get(activeNavKey);

    if (!entry || entry.hidden) return null;

    return (
      <Drawer
        noHeader
        closable={false}
        open={open}
        placement={'left'}
        width={260}
        zIndex={200}
        style={{
          background: cssVar.colorBgContainer,
          borderRight: `0.5px solid ${cssVar.colorBorderSecondary}`,
        }}
        styles={{
          bodyContent: {
            height: '100%',
            overflow: 'hidden',
            padding: 0,
            paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
            paddingInlineStart: 'max(0px, env(safe-area-inset-left))',
          },
        }}
        onClose={close}
      >
        <div
          style={{
            boxSizing: 'border-box',
            height: '100%',
            minWidth: 0,
            paddingTop: 'max(44px, env(safe-area-inset-top))',
            position: 'relative',
          }}
        >
          <ActionIcon
            aria-label={t('close')}
            data-mobile-nav-close=""
            icon={X}
            size={{ blockSize: 44, size: 18 }}
            style={{
              insetBlockStart: 'max(8px, env(safe-area-inset-top))',
              insetInlineEnd: 8,
              position: 'absolute',
              zIndex: 1,
            }}
            onClick={close}
          />
          {entry.node}
        </div>
      </Drawer>
    );
  },
);

export const MobileNavPanelProvider = ({ children }: PropsWithChildren) => {
  const [open, setOpen] = useState(false);
  const { pathname, search } = useActiveLocation();
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  useEffect(() => close(), [close, pathname, search]);

  const controller = useMemo(() => ({ close, open, toggle }), [close, open, toggle]);

  return (
    <MobileNavPanelContext value={controller}>
      {children}
      <MobileNavPanelDrawer close={close} open={open} />
    </MobileNavPanelContext>
  );
};
