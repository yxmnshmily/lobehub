import { createStaticStyles } from 'antd-style';

interface ResolveMainContainerHeightParams {
  bannerHeight: number;
  desktop: boolean;
  showCloudPromotion: boolean;
  titleBarHeight: number;
}

export const resolveMainContainerHeight = ({
  bannerHeight,
  desktop,
  showCloudPromotion,
  titleBarHeight,
}: ResolveMainContainerHeightParams) => {
  const reservedHeight = (desktop ? titleBarHeight : 0) + (showCloudPromotion ? bannerHeight : 0);

  return reservedHeight > 0 ? `calc(100% - ${reservedHeight}px)` : '100%';
};

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Main container - non-PWA mode (no top border)
  mainContainer: css`
    position: relative;
  `,

  // Main container - PWA mode (with top border)
  mainContainerPWA: css`
    position: relative;
    border-block-start: 0.5px solid ${cssVar.colorBorder};
  `,
}));
