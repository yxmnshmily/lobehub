import { Github, ModelTag, ProviderCombine } from '@lobehub/icons';
import { Block, Flexbox, Icon, MaskShadow, stopPropagation } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import { GlobeIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { GITHUB } from '@/const/url';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { type DiscoverProviderItem } from '@/types/discover';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    author: css`
      color: ${cssVar.colorTextDescription};
    `,
    code: css`
      font-family: ${cssVar.fontFamilyCode};
    `,
    desc: css`
      flex: none;
      margin: 0 !important;
      color: ${cssVar.colorTextSecondary};
    `,
    footer: css`
      margin-block-start: 16px;
      border-block-start: 1px dashed ${cssVar.colorBorder};
      background: ${cssVar.colorBgContainer};
    `,
    secondaryDesc: css`
      font-size: 12px;
      color: ${cssVar.colorTextDescription};
    `,
    title: css`
      margin: 0 !important;
      font-size: 16px !important;
      font-weight: 500 !important;

      &:hover {
        color: ${cssVar.colorLink};
      }
    `,
  };
});

const ProviderItem = memo<DiscoverProviderItem>(
  ({ url, name, description, identifier, models }) => {
    const navigate = useWorkspaceAwareNavigate();
    const link = urlJoin('/community/provider', identifier);
    const { t } = useTranslation(['discover', 'providers']);
    const { mobile: responsiveMobile = false } = useResponsive();
    const serverMobile = useServerConfigStore(serverConfigSelectors.isMobile);
    const mobile = serverMobile || responsiveMobile;
    const modelLinks = models
      .slice(0, 6)
      .filter(Boolean)
      .map((tag: string) => (
        <WorkspaceLink
          key={tag}
          to={urlJoin('/community/model', tag)}
          style={
            mobile
              ? {
                  alignItems: 'center',
                  display: 'inline-flex',
                  maxWidth: '100%',
                  minHeight: 44,
                  overflow: 'hidden',
                }
              : undefined
          }
        >
          <ModelTag
            model={tag}
            style={{
              height: 'auto',
              margin: 0,
              maxWidth: '100%',
              whiteSpace: mobile ? 'normal' : undefined,
              wordBreak: mobile ? 'break-all' : undefined,
            }}
          />
        </WorkspaceLink>
      ));

    return (
      <Block
        clickable
        data-testid="provider-item"
        height={'100%'}
        variant={'outlined'}
        width={'100%'}
        style={{
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={() => {
          navigate(link);
        }}
      >
        <Flexbox
          horizontal
          align={'flex-start'}
          gap={16}
          justify={'space-between'}
          padding={16}
          width={'100%'}
        >
          <Flexbox
            title={identifier}
            style={{
              overflow: 'hidden',
            }}
          >
            <WorkspaceLink style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
              <ProviderCombine provider={identifier} size={28} style={{ flex: 'none' }} />
            </WorkspaceLink>
            <div className={styles.author}>@{name}</div>
          </Flexbox>
          <Flexbox horizontal align={'center'}>
            <a
              aria-label={`${name} homepage`}
              href={url}
              rel="noopener noreferrer"
              target={'_blank'}
              style={
                mobile
                  ? {
                      alignItems: 'center',
                      display: 'inline-flex',
                      justifyContent: 'center',
                      minHeight: 44,
                      minWidth: 44,
                    }
                  : undefined
              }
              onClick={stopPropagation}
            >
              <Icon color={cssVar.colorTextDescription} icon={GlobeIcon} />
            </a>
            <a
              aria-label={`${name} GitHub`}
              href={urlJoin(GITHUB, 'blob/main/src/config/modelProviders', `${identifier}.ts`)}
              rel="noopener noreferrer"
              target={'_blank'}
              style={
                mobile
                  ? {
                      alignItems: 'center',
                      display: 'inline-flex',
                      justifyContent: 'center',
                      minHeight: 44,
                      minWidth: 44,
                    }
                  : undefined
              }
              onClick={stopPropagation}
            >
              <Icon fill={cssVar.colorTextDescription} icon={Github} />
            </a>
          </Flexbox>
        </Flexbox>
        <Flexbox flex={1} gap={12} paddingInline={16}>
          {description && (
            <Text
              className={styles.desc}
              ellipsis={{
                rows: 3,
              }}
            >
              {t(`${identifier}.description`, { defaultValue: description, ns: 'providers' })}
            </Text>
          )}
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.footer}
          justify={'space-between'}
          padding={16}
        >
          {mobile ? (
            <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }} width={'100%'}>
              {modelLinks}
            </Flexbox>
          ) : (
            <MaskShadow horizontal gap={6} position={'right'} size={10} width={'100%'}>
              {modelLinks}
            </MaskShadow>
          )}
        </Flexbox>
      </Block>
    );
  },
);

export default ProviderItem;
