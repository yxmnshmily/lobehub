'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Segmented, type SegmentedOptions, Select, type SelectProps } from '@lobehub/ui/base-ui';
import { createStaticStyles, useResponsive } from 'antd-style';
import { FilePenLine, ImageIcon, Video } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';

export interface GenerationMediaModeSegmentProps {
  /** `hero`: large labeled headline select. `toolbar`: compact icon-only toggle group. */
  layout?: 'hero' | 'toolbar' | 'sidebar';
  mode: 'image' | 'video' | 'page';
}

const styles = createStaticStyles(({ css }) => ({
  heroSelect: css`
    width: auto;
    font-size: inherit;
    line-height: 1.2;
  `,
  sidebarSelect: css`
    gap: 4px;

    width: auto;
    height: 32px;
    min-height: 32px;
    padding-block: 3px;
    padding-inline: 6px;

    font-size: 14px;
    line-height: 20px;
  `,
  heroText: css`
    font-size: 24px;
    font-weight: 600;
    line-height: 1.2;
  `,
  toolbarItem: css`
    width: 30px;
    height: 30px;
    padding-inline: 0;
  `,
  toolbarItemMobile: css`
    min-width: 44px;
    min-height: 44px;
  `,
  toolbarLabel: css`
    display: none;
  `,
}));

const GenerationMediaModeSegment = memo<GenerationMediaModeSegmentProps>(
  ({ mode, layout = 'toolbar' }) => {
    const { t } = useTranslation(['common', 'file']);
    const { mobile = false } = useResponsive();
    const navigate = useWorkspaceAwareNavigate();
    const isHero = layout === 'hero';
    const isSidebar = layout === 'sidebar';
    const { allowed: canCreate } = usePermission('create_content');

    const heroOptions = useMemo<SelectProps['options']>(
      () => [
        {
          label: (
            <Flexbox horizontal align="center" gap={8}>
              <span className={isHero ? styles.heroText : undefined}>{t('tab.image')}</span>
            </Flexbox>
          ),
          value: 'image',
        },
        {
          label: (
            <Flexbox horizontal align="center" gap={8}>
              <span className={isHero ? styles.heroText : undefined}>{t('tab.video')}</span>
            </Flexbox>
          ),
          value: 'video',
        },
        {
          label: <span className={isHero ? styles.heroText : undefined}>{t('tab.pages')}</span>,
          value: 'page',
        },
      ],
      [isHero, t],
    );

    const toolbarOptions = useMemo<SegmentedOptions<'image' | 'video' | 'page'>>(
      () => [
        {
          icon: <Icon icon={ImageIcon} size={16} />,
          label: t('tab.image'),
          title: t('tab.image'),
          value: 'image',
        },
        {
          icon: <Icon icon={Video} size={16} />,
          label: t('tab.video'),
          title: t('tab.video'),
          value: 'video',
        },
        {
          icon: <Icon icon={FilePenLine} size={16} />,
          label: t('tab.pages'),
          title: t('tab.pages'),
          value: 'page',
        },
      ],
      [t],
    );

    const labelRender: SelectProps['labelRender'] = useCallback(
      (props: any) => {
        const v = String((props as { value?: string }).value ?? '');
        const text =
          v === 'page' ? t('tab.pages') : v === 'video' ? t('tab.video') : t('tab.image');
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 'inherit',
              fontWeight: isSidebar ? 500 : 600,
              whiteSpace: 'nowrap',
            }}
          >
            {isSidebar && (
              <Icon
                icon={v === 'page' ? FilePenLine : v === 'video' ? Video : ImageIcon}
                size={18}
                style={{ display: 'inline-flex', width: 18, height: 18, flex: 'none' }}
              />
            )}
            {text}
          </span>
        );
      },
      [isSidebar, t],
    );

    const handleChange = useCallback(
      (value: string) => {
        if (value === mode || (value === 'page' && !canCreate)) return;
        navigate(value === 'page' ? '/page/new' : value === 'video' ? '/video' : '/image');
      },
      [canCreate, mode, navigate],
    );

    if (layout === 'toolbar')
      return (
        <Segmented<'image' | 'video' | 'page'>
          options={toolbarOptions}
          size={mobile ? 'large' : 'small'}
          value={mode}
          classNames={{
            item: mobile ? styles.toolbarItemMobile : styles.toolbarItem,
            itemLabel: styles.toolbarLabel,
          }}
          onChange={handleChange}
        />
      );

    return (
      <Select
        className={isSidebar ? styles.sidebarSelect : styles.heroSelect}
        labelRender={labelRender}
        options={heroOptions}
        popupMatchSelectWidth={false}
        size={isSidebar ? 'small' : 'large'}
        value={mode}
        variant={'borderless'}
        onChange={handleChange}
      />
    );
  },
);

GenerationMediaModeSegment.displayName = 'GenerationMediaModeSegment';

export default GenerationMediaModeSegment;
