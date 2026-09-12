'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Drawer } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { MenuIcon } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Menu from '@/components/Menu';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { SCROLL_PARENT_ID } from '../../../../(main)/community/features/const';
import { getCommunityCategoryPath, useNav } from '../../../../(main)/community/features/useNav';

const SCROLL_CONTAINER_ID = 'lobe-mobile-scroll-container';

const scrollToTop = () => {
  const scrollableElement = globalThis.document?.querySelector(
    `#${SCROLL_PARENT_ID}, #${SCROLL_CONTAINER_ID}`,
  );

  if (!scrollableElement) return;
  scrollableElement.scrollTo({ behavior: 'auto', top: 0 });
};

export const styles = createStaticStyles(({ css, cssVar }) => ({
  activeNavItem: css`
    background: ${cssVar.colorFillTertiary};
  `,
  categoryItem: css`
    cursor: pointer;

    display: inline-flex;
    flex: none;
    gap: 8px;
    align-items: center;
    justify-content: center;

    min-height: 44px;
    padding-block: 0;
    padding-inline: var(--mobile-page-gutter, 10px);
    border: 0;
    border-radius: ${cssVar.borderRadius};

    font: inherit;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    background: transparent;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  categoryItemActive: css`
    font-weight: 600;
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  categoryNav: css`
    scrollbar-width: none;
    overflow-x: auto;
    overscroll-behavior-inline: contain;

    box-sizing: border-box;
    width: 100%;
    padding-inline: var(--mobile-page-gutter, 10px);
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};

    touch-action: pan-x;
    -webkit-overflow-scrolling: touch;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
  categoryTrack: css`
    display: flex;
    width: max-content;
    min-width: 100%;
    gap: 4px;
  `,
  container: css`
    height: auto;
    padding-block: 4px;
    background: ${cssVar.colorBgContainer};
  `,
  navItem: css`
    font-weight: 500;
  `,
  title: css`
    font-size: 18px;
    font-weight: 700;
    line-height: 1.2;
  `,
}));

const Nav = memo(() => {
  const [open, setOpen] = useState(false);
  const { items, activeKey, activeItem } = useNav();
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation('discover');

  return (
    <>
      <Flexbox horizontal align={'center'} className={styles.title} gap={4}>
        <ActionIcon
          aria-expanded={open}
          color={cssVar.colorText}
          icon={MenuIcon}
          size={{ blockSize: 44, size: 18 }}
          aria-label={`${t(
            open ? 'agentViewAll.sidebarSection.collapse' : 'agentViewAll.sidebarSection.expand',
            { ns: 'common' },
          )} ${t('tab.community', { ns: 'common' })}`}
          onClick={() => {
            setOpen(true);
          }}
        />
        {activeItem?.label}
      </Flexbox>

      <Drawer
        noHeader
        closable={false}
        open={open}
        placement={'left'}
        width={260}
        zIndex={200}
        style={{
          background: cssVar.colorBgContainer,
          borderRight: `0.5px solid ${cssVar.colorSplit}`,
          paddingTop: 'max(44px, env(safe-area-inset-top))',
        }}
        styles={{
          bodyContent: {
            gap: 20,
            justifyContent: 'space-between',
            padding: 16,
            paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
            paddingInlineStart: 'max(16px, env(safe-area-inset-left))',
          },
        }}
        onClose={() => setOpen(false)}
      >
        <Menu
          compact
          selectable
          items={items}
          selectedKeys={[activeKey]}
          onClick={({ key }) => {
            scrollToTop();
            navigate(getCommunityCategoryPath(key));
            setOpen(false);
          }}
        />
      </Drawer>
    </>
  );
});

export const CategoryNav = memo(() => {
  const { activeKey, navItems } = useNav();
  const navigate = useWorkspaceAwareNavigate();
  const navigationRef = useRef<HTMLElement>(null);
  const { t } = useTranslation('discover');

  useEffect(() => {
    if (!navigationRef.current) return;

    const activeItem = navigationRef.current.querySelector<HTMLElement>('[aria-current="page"]');
    if (!activeItem) return;

    const navigationRect = navigationRef.current.getBoundingClientRect();
    const activeItemRect = activeItem.getBoundingClientRect();
    const isVisible =
      activeItemRect.left >= navigationRect.left && activeItemRect.right <= navigationRect.right;

    if (!isVisible) {
      activeItem.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
    }
  }, [activeKey]);

  return (
    <nav
      aria-label={t('tab.community', { ns: 'common' })}
      className={styles.categoryNav}
      ref={navigationRef}
    >
      <div className={styles.categoryTrack}>
        {navItems.map((item) => {
          const active = item.key === activeKey;
          return (
            <button
              aria-current={active ? 'page' : undefined}
              className={cx(styles.categoryItem, active && styles.categoryItemActive)}
              key={item.key}
              type="button"
              onClick={() => {
                scrollToTop();
                navigate(getCommunityCategoryPath(item.key));
              }}
            >
              {item.icon}
              <span>{item.title}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
});

CategoryNav.displayName = 'CommunityCategoryNav';

export default Nav;
