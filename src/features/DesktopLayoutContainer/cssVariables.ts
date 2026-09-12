import { cssVar } from 'antd-style';

import { isDesktop } from '@/const/version';
import { getDarwinMajorVersion, isMacOSWithLargeWindowBorders } from '@/utils/platform';

export const getOuterCssVariables = ({ expand }: { expand?: boolean }): Record<string, string> => ({
  '--container-padding-left': isDesktop ? (expand ? '0px' : '8px') : '12px',
  '--container-padding-top': isDesktop ? '0px' : '12px',
});

export const getInnerCssVariables = ({ isDark }: { isDark: boolean }): Record<string, string> => {
  if (isDesktop) {
    const darwinMajorVersion = getDarwinMajorVersion();
    const borderRadius = darwinMajorVersion >= 25 ? '12px' : cssVar.borderRadius;
    const borderBottomRightRadius =
      darwinMajorVersion >= 26 || isMacOSWithLargeWindowBorders() ? '12px' : borderRadius;

    return {
      '--container-border-bottom-right-radius': borderBottomRightRadius,
      '--container-border-color': isDark ? cssVar.colorBorderSecondary : cssVar.colorBorder,
      '--container-border-radius': borderRadius,
    };
  }

  return {
    '--container-border-bottom-right-radius': '16px',
    '--container-border-color': isDark ? cssVar.colorBorderSecondary : cssVar.colorBorder,
    '--container-border-radius': '16px',
  };
};
