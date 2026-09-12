'use client';

import { Block } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { ChevronsUpDownIcon } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import { SkeletonItem } from '@/features/NavPanel/components/SkeletonList';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import SwitchPanel from './SwitchPanel';

const Agent = memo<PropsWithChildren>(() => {
  const { t } = useTranslation(['chat', 'common']);

  const { gid } = useActiveRouteParams<{ gid: string }>();
  const [isGroupsInit, groupMeta] = useAgentGroupStore((s) => [
    agentGroupSelectors.isGroupsInit(s),
    agentGroupSelectors.getGroupMeta(gid ?? '')(s),
  ]);

  const displayTitle = groupMeta?.title || t('untitledGroup', { ns: 'chat' });

  if (isGroupsInit) return <SkeletonItem height={32} padding={0} />;

  return (
    <SwitchPanel>
      <Block
        clickable
        horizontal
        align={'center'}
        gap={8}
        padding={2}
        variant={'borderless'}
        style={{
          minWidth: 32,
          overflow: 'hidden',
        }}
      >
        <ProductLogo size={28} style={{ flexShrink: 0 }} type="flat" />
        <Text ellipsis weight={500}>
          {displayTitle}
        </Text>
        <ActionIcon
          icon={ChevronsUpDownIcon}
          size={{
            blockSize: 28,
            size: 16,
          }}
          style={{
            width: 24,
          }}
        />
      </Block>
    </SwitchPanel>
  );
});

export default Agent;
