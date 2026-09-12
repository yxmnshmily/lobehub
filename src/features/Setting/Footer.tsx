'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Center, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { MessageSquareHeart } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { createGuideModal } from '@/components/GuideModal';
import GuideVideo from '@/components/GuideVideo';
import { GITHUB, GITHUB_ISSUES } from '@/const/url';
import { useServerConfigStore } from '@/store/serverConfig';
import { isOnServerSide } from '@/utils/env';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    max-width: 100%;
    line-height: 1.7;
    text-align: center;
    overflow-wrap: anywhere;
  `,
  footer: css`
    width: 100%;
    min-width: 0;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    @media (width <= 575px) {
      padding-inline: 0 !important;
    }
  `,
  link: css`
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  `,
}));

export const LayoutSettingsFooterClassName = 'settings-layout-footer';

const Footer = memo<PropsWithChildren>(() => {
  const { t } = useTranslation('common');

  const hideGitHubEngagementFooter = useServerConfigStore((s) =>
    Boolean(s.featureFlags.hideGitHub || s.serverConfig.enableBusinessFeatures),
  );

  const handleOpenStar = () =>
    createGuideModal({
      cancelText: t('footer.later'),
      cover: (
        <GuideVideo
          height={269}
          src={`https://hub-apac-1.lobeobjects.space/assets/star.mp4`}
          width={358}
        />
      ),
      desc: t('footer.star.desc'),
      okText: t('footer.star.action'),
      onOk: () => {
        if (isOnServerSide) return;
        window.open(GITHUB, '__blank');
      },
      title: t('footer.star.title'),
    });

  const handleOpenFeedback = () =>
    createGuideModal({
      cancelText: t('footer.later'),
      cover: (
        <GuideVideo
          height={269}
          src={'<@985522149420855317> https://hub-apac-1.lobeobjects.space/assets/feedback.mp4'}
          width={358}
        />
      ),
      desc: t('footer.feedback.desc', { appName: BRANDING_NAME }),
      okText: t('footer.feedback.action'),
      onOk: () => {
        if (isOnServerSide) return;
        window.open(GITHUB_ISSUES, '__blank');
      },
      title: t('footer.feedback.title'),
    });

  return hideGitHubEngagementFooter ? null : (
    <Flexbox className={LayoutSettingsFooterClassName} justify={'flex-end'}>
      <Center
        horizontal
        as={'footer'}
        className={styles.footer}
        flex={'none'}
        padding={8}
        width={'100%'}
      >
        <div className={styles.body}>
          <Icon icon={MessageSquareHeart} /> {`${t('footer.title')} `}
          <a
            aria-label={'star'}
            className={styles.link}
            href={GITHUB}
            onClick={(e) => {
              e.preventDefault();
              handleOpenStar();
            }}
          >
            {t('footer.action.star')}
          </a>
          {` ${t('footer.and')} `}
          <a
            aria-label={'feedback'}
            className={styles.link}
            href={GITHUB_ISSUES}
            onClick={(e) => {
              e.preventDefault();
              handleOpenFeedback();
            }}
          >
            {t('footer.action.feedback')}
          </a>
          {' !'}
        </div>
      </Center>
    </Flexbox>
  );
});

Footer.displayName = 'SettingFooter';

export default Footer;
