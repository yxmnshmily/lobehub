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
  /* 手机端弹层不再整层 zoom（会把三个选项挤得极小），改为选项文字
     直接用 14px（见上方 heroText 的媒体查询） */
  heroPopup: css`
    @media (width <= 767px) {
      font-size: 14px;
    }
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

    /* 手机端弹层选项缩小到可读尺寸：标题 zoom 0.5 后触发文字约 12px，
       弹层选项用 14px 保持可读且比例协调（不整层 zoom——那会把三个选项
       挤成一小坨） */
    @media (width <= 767px) {
      font-size: 14px;
    }
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
          /* 手机端图标 20px：16px 字形在 44px 按钮里显小（2026-09-18） */
          icon: <Icon icon={ImageIcon} size={mobile ? 20 : 16} />,
          label: t('tab.image'),
          title: t('tab.image'),
          value: 'image',
        },
        {
          icon: <Icon icon={Video} size={mobile ? 20 : 16} />,
          label: t('tab.video'),
          title: t('tab.video'),
          value: 'video',
        },
        {
          icon: <Icon icon={FilePenLine} size={mobile ? 20 : 16} />,
          label: t('tab.pages'),
          title: t('tab.pages'),
          value: 'page',
        },
      ],
      [mobile, t],
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
        popupClassName={isHero ? styles.heroPopup : undefined}
        popupMatchSelectWidth={false}
        size={isSidebar ? 'small' : 'large'}
        value={mode}
        variant={'borderless'}
        onChange={handleChange}
        /* 弹层固定向下展开：默认行为在窗口矮时会整个翻转到上方，用户要求
           始终在下方——side:'none' 关闭翻转，弹层贴触发器下方 6px，
           空间不足时仅轻微上移（需要 @lobehub/ui 补丁透传 positionerProps，
           见 patches/@lobehub%2Fui@5.42.2.patch）。 */
        positionerProps={{ collisionAvoidance: { side: 'none' } }}
      />
    );
  },
);

GenerationMediaModeSegment.displayName = 'GenerationMediaModeSegment';

export default GenerationMediaModeSegment;
