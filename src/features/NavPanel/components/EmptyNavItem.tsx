import { Block, Center, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { PlusIcon } from 'lucide-react';
import { memo } from 'react';

interface EmptyStatusProps {
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}

const EmptyNavItem = memo<EmptyStatusProps>(({ title, onClick, className, disabled }) => {
  return (
    <Block
      horizontal
      align={'center'}
      aria-label={title}
      className={className}
      clickable={!disabled}
      data-nav-item=""
      gap={8}
      height={32}
      paddingInline={2}
      style={disabled ? { cursor: 'not-allowed', opacity: 0.5 } : undefined}
      title={title}
      variant={'borderless'}
      onClick={disabled ? undefined : onClick}
    >
      <Center flex={'none'} height={28} width={28}>
        <Icon icon={PlusIcon} size={'small'} />
      </Center>
      <Text align={'center'} data-nav-label="" type={'secondary'}>
        {title}
      </Text>
    </Block>
  );
});

export default EmptyNavItem;
