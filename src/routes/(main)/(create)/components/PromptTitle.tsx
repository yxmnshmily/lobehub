'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import GenerationMediaModeSegment from '@/routes/(main)/(create)/features/GenerationInput/GenerationMediaModeSegment';

const styles = createStaticStyles(({ css }) => ({
  title: css`
    margin-block-end: 24px;
    font-size: 28px;
    font-weight: bold;

    /* 手机端（≤767px 视口）：整个标题块（文字 + 模式切换）整体缩小一半，
       zoom 同时收缩布局尺寸，不留缩放空洞；网页端不变。 */
    @media (width <= 767px) {
      zoom: 0.5;
    }
  `,
}));

interface PromptTitleProps {
  mode: 'image' | 'video';
}

const PromptTitle = memo<PromptTitleProps>(({ mode }) => {
  const { t } = useTranslation('common');

  return (
    <Flexbox horizontal align={'center'} className={styles.title} justify={'center'} width={'100%'}>
      {t('generation.hero.taglinePrefix')}
      <GenerationMediaModeSegment layout={'hero'} mode={mode} />
    </Flexbox>
  );
});

PromptTitle.displayName = 'PromptTitle';

export default PromptTitle;
