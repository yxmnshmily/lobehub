'use client';

import { ActionIcon } from '@lobehub/ui/base-ui';
import { useResponsive } from 'antd-style';
import { PanelLeftRightDashedIcon, SquareChartGanttIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE, MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const WideScreenButton = memo(() => {
  const { t } = useTranslation('chat');
  const { mobile = false } = useResponsive();

  const [wideScreen, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleWideScreen,
  ]);
  const label = t(wideScreen ? 'toggleWideScreen.off' : 'toggleWideScreen.on');

  return (
    <ActionIcon
      aria-label={label}
      icon={wideScreen ? SquareChartGanttIcon : PanelLeftRightDashedIcon}
      size={mobile ? MOBILE_HEADER_ICON_SIZE : DESKTOP_HEADER_ICON_SMALL_SIZE}
      title={label}
      tooltipProps={{
        placement: 'bottom',
      }}
      onClick={() => toggleWideScreen()}
    />
  );
});

export default WideScreenButton;
