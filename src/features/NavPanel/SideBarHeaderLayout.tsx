'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import type { BreadcrumbProps } from 'antd';
import { Breadcrumb } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronRightIcon, HomeIcon } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { memo } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { isModifierClick } from '@/utils/navigation';

import BackButton from './components/BackButton';
import ToggleLeftPanelButton from './ToggleLeftPanelButton';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  breadcrumb: css`
    ol {
      flex-wrap: nowrap;
      align-items: center;
    }
    .${prefixCls}-breadcrumb-separator {
      margin-inline: 6px;
      color: ${cssVar.colorTextQuaternary};
    }
    .${prefixCls}-breadcrumb-link {
      cursor: pointer;

      display: flex !important;
      align-items: center !important;

      /* 24px minimum hit height for a clickable crumb, plus the pointer
         affordance. */
      min-height: 24px;
      padding-block: 6px !important;
      padding-inline: 8px !important;
      border-radius: 8px;

      font-size: 13px;
      color: ${cssVar.colorTextDescription};

      transition: background-color 0.2s ${cssVar.motionEaseInOut};
    }
    .${prefixCls}-breadcrumb-link:has([role='combobox']) {
      padding: 0 !important;
    }

    ol:has([role='combobox']) {
      .${prefixCls}-breadcrumb-link {
        box-sizing: border-box;
        height: 32px;
        min-height: 32px;

        font-size: 14px;
        font-weight: 500;
        line-height: 20px;
      }
      a.${prefixCls}-breadcrumb-link {
        padding-block: 0 !important;
        padding-inline: 6px !important;
      }
      a.${prefixCls}-breadcrumb-link > span {
        gap: 6px !important;
      }

      svg {
        flex: none;
        width: 18px;
        height: 18px;
      }
      .${prefixCls}-breadcrumb-separator {
        display: flex;
        align-items: center;
        margin-inline: 4px;
      }
    }
    a.${prefixCls}-breadcrumb-link:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
    a.${prefixCls}-breadcrumb-link {
      &:hover {
        color: ${cssVar.colorText};
      }
    }
  `,
  container: css`
    overflow: hidden;
  `,
  breadcrumbContainer: css`
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
  `,
  /* A breadcrumb-only header row used to sit inside its own flex wrapper;
     the row duties live on the breadcrumb itself so the nav pane keeps one
     less nested div. Mirrors the wrapper's padding/height/centering. */
  breadcrumbRow: css`
    overflow: hidden;
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    box-sizing: border-box;

    /* Fixed, not minimum: every sidebar that shows only a breadcrumb must
       measure exactly the same, whatever the crumb content is. */
    height: 64px;
    padding-block: 8px;
  `,
}));

type BreadcrumbItem = NonNullable<BreadcrumbProps['items']>[number];

interface SideBarHeaderLayoutProps {
  backTo?: string;
  breadcrumb?: BreadcrumbProps['items'];
  /** Override the leading home breadcrumb item (defaults to home icon → `/`). */
  homeItem?: BreadcrumbItem;
  left?: ReactNode;
  right?: ReactNode;
  showBack?: boolean;
  showTogglePanelButton?: boolean;
}

const SideBarHeaderLayout = memo<SideBarHeaderLayoutProps>(
  ({
    left,
    right,
    backTo = '/group/default',
    showBack = true,
    breadcrumb = [],
    homeItem,
    showTogglePanelButton = false,
  }) => {
    const navigate = useWorkspaceAwareNavigate();
    const { t } = useTranslation('common');
    const hasActions = showTogglePanelButton || !!right;
    const isBreadcrumbRow = !left && breadcrumb.length > 0;

    const items = [
      homeItem ?? {
        href: '/group/default',
        title: (
          <span
            aria-label={t('backToHome')}
            title={t('backToHome')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              whiteSpace: 'nowrap',
            }}
          >
            <Icon icon={HomeIcon} />
            <span data-nav-label="">{t('backToHome')}</span>
          </span>
        ),
      },
      ...breadcrumb,
    ].map((item) => ({
      ...item,
      onClick: (event: MouseEvent<HTMLElement>) => {
        if (isModifierClick(event)) return;
        const href = item.href;
        if (href) {
          event.preventDefault();
          event.stopPropagation();
          // eslint-disable-next-line @eslint-react/dom/no-flush-sync
          flushSync(() => navigate(href));
        }
      },
    }));

    const leftContent = left ? (
      <Flexbox
        horizontal
        align={'center'}
        flex={1}
        gap={2}
        style={{
          overflow: 'hidden',
        }}
      >
        {showBack && <BackButton size={DESKTOP_HEADER_ICON_SMALL_SIZE} to={backTo} />}
        {left && typeof left === 'string' ? (
          <Text ellipsis fontSize={16} weight={500}>
            {left}
          </Text>
        ) : (
          left
        )}
      </Flexbox>
    ) : (
      <Breadcrumb
        className={styles.breadcrumb}
        data-nav-breadcrumb=""
        items={items}
        separator={<Icon icon={ChevronRightIcon} />}
        style={{ minWidth: 0 }}
      />
    );

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={cx(styles.container, isBreadcrumbRow && styles.breadcrumbContainer)}
        data-nav-header=""
        flex={'none'}
        paddingBlock={8}
        paddingInline={10}
        justify={
          hasActions && isBreadcrumbRow ? 'space-between' : hasActions ? 'space-between' : 'center'
        }
        /* Three-part symmetric row: an empty left spacer, the breadcrumb in the
           middle and the actions on the right, so the crumb stays optically
           centred and the action keeps the 8px minimum gap from the edge. */
        style={{
          ...(breadcrumb.length > 0 ? { minHeight: 64 } : null),
        }}
      >
        <Flexbox
          horizontal
          align={'center'}
          justify={isBreadcrumbRow ? 'flex-start' : 'center'}
          style={{ flex: 1, minWidth: 0 }}
        >
          {leftContent}
        </Flexbox>
        {hasActions && (
          <Flexbox
            horizontal
            align={'center'}
            data-nav-header-actions=""
            gap={2}
            justify={'flex-end'}
            style={{ flex: 'none' }}
          >
            {showTogglePanelButton && (
              /* Comfortable hit area for the collapse control. */
              <ToggleLeftPanelButton size={'middle'} />
            )}
            {right}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default SideBarHeaderLayout;
