import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import type { ReactNode } from 'react';

export default function GroupWelcome({
  avatar,
  title,
  description,
  children,
}: {
  avatar: ReactNode;
  title?: string | null;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <Flexbox flex={1} />
      <Flexbox gap={12} style={{ paddingBottom: 'max(10vh, 32px)' }} width="100%">
        {avatar}
        <Text fontSize={32} weight="bold">
          {title}
        </Text>
        <Flexbox width="min(100%, 640px)">{description}</Flexbox>
        {children}
      </Flexbox>
    </>
  );
}
