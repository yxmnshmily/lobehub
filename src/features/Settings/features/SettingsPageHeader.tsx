import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type ComponentProps, memo } from 'react';

import PageHeader from '@/features/NavHeader/PageHeader';

const styles = createStaticStyles(({ css }) => ({
  root: css`
    flex: none;

    height: 64px !important;
    padding-inline: 20px !important;
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
}));

type SettingsPageHeaderProps = ComponentProps<typeof PageHeader>;

const SettingsPageHeader = memo<SettingsPageHeaderProps>(
  ({ className, styles: customStyles, ...rest }) => (
    <PageHeader
      {...rest}
      className={cx(styles.root, className)}
      styles={{
        center: { alignItems: 'flex-start', paddingInline: 8, ...customStyles?.center },
        left: { flex: 'none', ...customStyles?.left },
        right: { flex: 'none', ...customStyles?.right },
      }}
    />
  ),
);

SettingsPageHeader.displayName = 'SettingsPageHeader';

export default SettingsPageHeader;
