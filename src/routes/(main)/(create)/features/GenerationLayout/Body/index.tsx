'use client';

import { Accordion, AccordionItem, Flexbox, Icon } from '@lobehub/ui';
import { Tabs, Text } from '@lobehub/ui/base-ui';
import { History, LayoutGrid, ListIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import CompactListPopover from '@/features/NavPanel/components/CompactListPopover';
import { useEffectiveNavPanelExpanded } from '@/features/NavPanel/hooks/useEffectiveNavPanelExpanded';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import type { GenerationLayoutCommonProps } from '../types';
import List from './List';

enum GroupKey {
  PrivateTopics = 'private-topics',
  Topics = 'topics',
  WorkspaceTopics = 'workspace-topics',
}

const Body = memo<GenerationLayoutCommonProps>((props) => {
  const { namespace, useStore, viewModeStatusKey, generationTopicsSelector } = props;
  const { t } = useTranslation(namespace);
  const isLogin = useUserStore(authSelectors.isLogin);
  const viewMode = useGlobalStore((s) => systemStatusSelectors[viewModeStatusKey](s));
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  /* 用"有效展开"判定（与 64px 侧栏壳同一套输入：用户偏好 AND 视口）——
     不能只读 showLeftPanel，否则窄栏下会把完整网格塞进 64px rail（溢出错乱）。
     手机端（≤767px）一律弹窗。 */
  const expanded = useEffectiveNavPanelExpanded();
  const isMobile = useIsMobile();
  const activeWorkspaceId = useActiveWorkspaceId();

  const useFetchGenerationTopics = useStore((s: any) => s.useFetchGenerationTopics);
  useFetchGenerationTopics(!!isLogin);

  const generationTopics = useStore(generationTopicsSelector);
  const count = generationTopics?.length || 0;
  const privateCount =
    generationTopics?.filter((topic: any) => topic.visibility === 'private').length || 0;
  const workspaceCount =
    generationTopics?.filter((topic: any) => topic.visibility !== 'private').length || 0;

  const viewModeTabs = (
    <Flexbox horizontal gap={2}>
      <Tabs
        activeKey={viewMode}
        size={'small'}
        items={[
          {
            icon: <Icon icon={ListIcon} />,
            key: 'list',
            label: null,
          },
          {
            icon: <Icon icon={LayoutGrid} />,
            key: 'grid',
            label: null,
          },
        ]}
        onChange={(key) => updateSystemStatus({ [viewModeStatusKey]: key })}
      />
    </Flexbox>
  );

  if (!expanded || isMobile) {
    return (
      <Flexbox paddingInline={4}>
        <CompactListPopover
          /* 历史记录用"历史时间"图标（时钟回溯），不用栏目本身的图片/视频图标 */
          icon={History}
          title={`${t('topic.title')}（${count}）`}
        >
          {/* 弹窗内固定为"缩略图+标题"列表形态 */}
          <List
            namespace={namespace}
            useStore={useStore}
            viewModeOverride="list"
            viewModeStatusKey={viewModeStatusKey}
          />
        </CompactListPopover>
      </Flexbox>
    );
  }

  if (activeWorkspaceId) {
    return (
      <Flexbox gap={1} paddingInline={4}>
        <Accordion defaultExpandedKeys={[GroupKey.PrivateTopics, GroupKey.WorkspaceTopics]} gap={2}>
          <AccordionItem
            action={viewModeTabs}
            itemKey={GroupKey.PrivateTopics}
            paddingBlock={4}
            paddingInline={'8px 4px'}
            title={
              <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                {t('topic.privateTitle')}
                {privateCount > 0 && ` ${privateCount}`}
              </Text>
            }
          >
            <List
              namespace={namespace}
              useStore={useStore}
              viewModeStatusKey={viewModeStatusKey}
              visibility="private"
            />
          </AccordionItem>
          <AccordionItem
            itemKey={GroupKey.WorkspaceTopics}
            paddingBlock={4}
            paddingInline={'8px 4px'}
            title={
              <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                {t('topic.workspaceTitle')}
                {workspaceCount > 0 && ` ${workspaceCount}`}
              </Text>
            }
          >
            <List
              namespace={namespace}
              useStore={useStore}
              viewModeStatusKey={viewModeStatusKey}
              visibility="public"
            />
          </AccordionItem>
        </Accordion>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={1} paddingInline={4}>
      <Accordion defaultExpandedKeys={[GroupKey.Topics]} gap={2}>
        <AccordionItem
          action={viewModeTabs}
          itemKey={GroupKey.Topics}
          paddingBlock={4}
          paddingInline={'8px 4px'}
          title={
            <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
              {t('topic.title')}
              {`（${count}）`}
            </Text>
          }
        >
          <List namespace={namespace} useStore={useStore} viewModeStatusKey={viewModeStatusKey} />
        </AccordionItem>
      </Accordion>
    </Flexbox>
  );
});

Body.displayName = 'GenerationLayoutBody';

export default Body;
