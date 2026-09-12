import { Text } from '@lobehub/ui/base-ui';
import { type ReactNode } from 'react';

import NavHeader, { type NavHeaderProps } from './index';

interface PageHeaderProps extends Omit<NavHeaderProps, 'children' | 'title'> {
  extra?: ReactNode;
  title: ReactNode;
}

// Settings and memory pages share the same centered title and header height.
const PageHeader = ({ title, extra, right, styles, ...rest }: PageHeaderProps) => (
  <NavHeader
    {...rest}
    right={right ?? extra}
    styles={{
      center: { alignItems: 'center', minWidth: 0, ...styles?.center },
      left: { flex: 1, ...styles?.left },
      right: { flex: 1, ...styles?.right },
    }}
  >
    <Text ellipsis style={{ maxWidth: '100%' }} weight={500}>
      {title}
    </Text>
  </NavHeader>
);

export default PageHeader;
