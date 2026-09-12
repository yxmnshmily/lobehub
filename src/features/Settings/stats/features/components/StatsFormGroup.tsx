'use client';

import { type BlockProps } from '@lobehub/ui';
import { Block, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { useResponsive } from 'antd-style';
import { type ReactNode } from 'react';
import { memo } from 'react';

interface StatsFormGroupProps extends Omit<BlockProps, 'title'> {
  afterTitle?: ReactNode;
  children: ReactNode;
  extra?: ReactNode;
  fontSize?: number;
  title?: string;
}

const StatsFormGroup = memo<StatsFormGroupProps>(
  ({ fontSize = 18, afterTitle, children, extra, style, title, ...rest }) => {
    const { mobile = false } = useResponsive();

    return (
      <Block
        gap={16}
        style={{ minWidth: 0, width: '100%', ...style }}
        variant={'borderless'}
        {...rest}
      >
        {mobile && afterTitle && extra ? (
          <Flexbox gap={8} style={{ minWidth: 0, width: '100%' }}>
            {title && (
              <Text
                fontSize={fontSize}
                style={{ minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'normal' }}
                weight={500}
              >
                {title}
              </Text>
            )}
            <Flexbox
              horizontal
              align={'center'}
              gap={8}
              style={{ flexWrap: 'wrap', minWidth: 0, width: '100%' }}
            >
              {afterTitle}
              {extra}
            </Flexbox>
          </Flexbox>
        ) : mobile ? (
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            justify={'space-between'}
            style={{ minWidth: 0, width: '100%' }}
          >
            {title && (
              <Text
                fontSize={fontSize}
                style={{ minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'normal' }}
                weight={500}
              >
                {title}
              </Text>
            )}
            {(afterTitle || extra) && (
              <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
                {afterTitle}
                {extra}
              </Flexbox>
            )}
          </Flexbox>
        ) : (
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
              <Text fontSize={fontSize} weight={500}>
                {title}
              </Text>
              {afterTitle}
            </Flexbox>
            <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
              {extra}
            </Flexbox>
          </Flexbox>
        )}
        <Flexbox style={{ maxWidth: '100%', minWidth: 0, width: '100%' }}>{children}</Flexbox>
      </Block>
    );
  },
);

export default StatsFormGroup;
