import { type MarkdownProps } from '@lobehub/ui';
import { Markdown } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import { displayBranding } from '@/utils/displayBranding';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    p:has(> .conversation-image) {
      display: inline-block;
      max-width: 100%;
      vertical-align: top;
    }
  `,
}));

const MarkdownMessage = memo<MarkdownProps>(({ children, className, componentProps, ...rest }) => {
  const { highlighterTheme, mermaidTheme, fontSize } = useUserStore(
    userGeneralSettingsSelectors.config,
  );

  return (
    <Markdown
      className={cx(styles.content, className)}
      fontSize={fontSize}
      variant={'chat'}
      componentProps={{
        ...componentProps,
        img: {
          maxHeight: 'min(480px, 50dvh)',
          maxWidth: '100%',
          objectFit: 'contain',
          ...componentProps?.img,
          className: cx('conversation-image', componentProps?.img?.className),
          style: {
            display: 'inline-block',
            marginInlineEnd: 8,
            maxWidth: 'calc(100% - 8px)',
            verticalAlign: 'top',
            ...componentProps?.img?.style,
          },
        },
        highlight: {
          fullFeatured: true,
          theme: highlighterTheme,
          ...componentProps?.highlight,
        },
        mermaid: { fullFeatured: false, theme: mermaidTheme, ...componentProps?.mermaid },
      }}
      {...rest}
    >
      {typeof children === 'string' ? displayBranding(children) : children}
    </Markdown>
  );
});

export default MarkdownMessage;
