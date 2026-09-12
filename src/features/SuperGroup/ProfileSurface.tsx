import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import type { ReactNode } from 'react';

import WideScreenContainer from '@/features/WideScreenContainer';

/** Administrator and member hosts share the profile canvas; only capabilities differ. */
export function ProfileSurface({
  children,
  header,
  onFocus,
}: {
  children: ReactNode;
  header: ReactNode;
  onFocus?: () => void;
}) {
  return (
    <Flexbox flex={1} height="100%" style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      {header}
      <Flexbox
        horizontal
        flex={1}
        style={{ minHeight: 0, overflowY: 'auto', position: 'relative' }}
        width="100%"
        onClick={onFocus}
      >
        <WideScreenContainer>{children}</WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
}

export function ProfileDocument({
  status,
  identity,
  controls,
  actions,
  children,
}: {
  status?: ReactNode;
  identity: ReactNode;
  controls?: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <Flexbox height={66} width="100%">
        <Flexbox paddingBlock={12}>{status}</Flexbox>
      </Flexbox>
      <Flexbox
        style={{ cursor: 'default', marginBottom: 12 }}
        onClick={(event) => event.stopPropagation()}
      >
        {identity}
        {controls}
        <Flexbox horizontal align="center" gap={8} style={{ marginTop: 16, flexWrap: 'wrap' }}>
          {actions}
        </Flexbox>
      </Flexbox>
      <Divider />
      {children}
    </>
  );
}
