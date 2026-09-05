export const shouldUseMobileToolLayout = (
  responsiveMobile: boolean,
  runtimeMobile: boolean,
  viewportMobile: boolean,
) => responsiveMobile || runtimeMobile || viewportMobile;
