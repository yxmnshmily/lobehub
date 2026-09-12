'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Avatar, Text, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { type LucideIcon, XIcon } from 'lucide-react';
import { memo, type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { settingsModalNavigationPresentation } from './modalPresentation';

export interface SettingsModalTabItem {
  icon?: LucideIcon;
  key: string;
  label: ReactNode;
}

export interface SettingsModalLayoutProps {
  activeTab?: string;
  avatar: string;
  background?: string;
  children: ReactNode;
  onTabChange?: (key: string) => void;
  tabs?: SettingsModalTabItem[];
  title: ReactNode;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: ${settingsModalNavigationPresentation.desktopDirection};

    min-width: 0;
    min-height: 0;

    @media (width < 768px) {
      flex-direction: ${settingsModalNavigationPresentation.mobileDirection};
    }
  `,
  content: css`
    scrollbar-gutter: stable;

    overflow: auto;
    overscroll-behavior: contain;
    flex: 1;

    min-width: 0;
    min-height: 0;
    padding-block: 8px 24px;
    padding-inline: 24px;

    background: ${cssVar.colorBgContainer};

    @media (width <= 767px) {
      padding-block: 4px max(16px, env(safe-area-inset-bottom));
      padding-inline: 16px;
    }
  `,
  header: css`
    flex-shrink: 0;

    min-height: 64px;
    padding-block: 16px;
    padding-inline: 24px;
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgElevated};

    @media (width <= 767px) {
      min-height: 56px;
      padding-block: 12px;
      padding-inline: 16px;
    }
  `,
  surface: css`
    overflow: hidden;
    border-radius: inherit;
    background: ${cssVar.colorBgElevated};
  `,
  navItem: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    width: 100%;
    min-height: 40px;
    padding-block: 8px;
    padding-inline: 12px;
    border: 0;
    border-radius: ${cssVar.borderRadiusLG};

    font: inherit;
    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
    text-align: start;

    background: transparent;

    transition:
      color 160ms ${cssVar.motionEaseOut},
      background 160ms ${cssVar.motionEaseOut};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 1px;
    }

    &[data-active='true'] {
      font-weight: 600;
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }

    @media (width < 768px) {
      flex-shrink: 0;

      width: auto;
      min-height: 36px;
      padding-block: 8px;
      padding-inline: 12px;
    }
  `,
  sideNav: css`
    display: flex;
    flex: 0 0 ${settingsModalNavigationPresentation.sidebarWidth}px;
    flex-direction: column;
    gap: 4px;

    width: ${settingsModalNavigationPresentation.sidebarWidth}px;
    padding: 12px;
    border-inline-end: 0.5px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainerSecondary};

    @media (width < 768px) {
      overflow-x: auto;
      flex: 0 0 auto;
      flex-direction: row;

      width: 100%;
      padding-block: 8px;
      padding-inline: 12px;
      border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
      border-inline-end: 0;
    }
  `,
}));

const SettingsModalLayout = memo<SettingsModalLayoutProps>(
  ({ avatar, background, title, tabs, activeTab, onTabChange, children }) => {
    const { t } = useTranslation('common');
    const { close } = useModalContext();
    const tabListId = useId();

    const tabItems = tabs?.map(({ icon, key, label }) => ({
      icon: icon ? <Icon icon={icon} size={16} /> : undefined,
      key,
      label,
    }));

    return (
      <Flexbox className={styles.surface} height={'100%'}>
        <Flexbox horizontal align={'center'} className={styles.header} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={12} style={{ minWidth: 0 }}>
            <Avatar avatar={avatar} background={background} shape={'square'} size={28} />
            <Text ellipsis fontSize={16} weight={600}>
              {title}
            </Text>
          </Flexbox>
          <ActionIcon icon={XIcon} title={t('cancel')} onClick={close} />
        </Flexbox>

        <Flexbox className={styles.body}>
          {tabItems && tabItems.length >= 2 && (
            <nav aria-label={String(title)} className={styles.sideNav} role={'tablist'}>
              {tabItems.map(({ icon, key, label }) => (
                <button
                  aria-selected={key === activeTab}
                  className={styles.navItem}
                  data-active={key === activeTab}
                  id={`${tabListId}-${key}`}
                  key={key}
                  role={'tab'}
                  type={'button'}
                  onClick={() => onTabChange?.(key)}
                >
                  {icon}
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          )}

          <Flexbox
            aria-labelledby={activeTab ? `${tabListId}-${activeTab}` : undefined}
            className={styles.content}
            role={tabItems && tabItems.length >= 2 ? 'tabpanel' : undefined}
          >
            {children}
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

export default SettingsModalLayout;
