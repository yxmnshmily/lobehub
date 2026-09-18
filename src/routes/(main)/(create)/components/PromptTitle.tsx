'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import GenerationMediaModeSegment from '@/routes/(main)/(create)/features/GenerationInput/GenerationMediaModeSegment';

interface PromptTitleProps {
  mode: 'image' | 'video';
}

const PromptTitle = memo<PromptTitleProps>(({ mode }) => {
  const { t } = useTranslation('common');
  /* 手机端（≤767px 视口）整块（文字 + 模式切换控件）缩放一半。
     zoom 走内联样式——本环境 antd-style 类在 HMR 下可能不生效，内联必定生效。 */
  const isMobile = useIsMobile();

  return (
    <Flexbox
      horizontal
      align={'center'}
      justify={'center'}
      width={'100%'}
      style={{
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 24,
        zoom: isMobile ? 0.5 : undefined,
      }}
    >
      {t('generation.hero.taglinePrefix')}
      <GenerationMediaModeSegment layout={'hero'} mode={mode} />
    </Flexbox>
  );
});

PromptTitle.displayName = 'PromptTitle';

export default PromptTitle;
