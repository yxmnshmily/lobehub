'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import RecentListItem from '@/features/Home/Recents/Item';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useClientDataSWR } from '@/libs/swr';
import { recentKeys } from '@/libs/swr/keys';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { recentService } from '@/services/recent';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import CollapseGroup from './CollapseGroup';

const RECENT_TOPICS_KEY = 'recentTopics';
const MOBILE_RECENT_TOPIC_LIMIT = 10;

const RecentTopics = memo(() => {
  const { t } = useTranslation('chat');
  const isLogin = useUserStore(authSelectors.isLogin);
  const scope = useCacheScope();
  const { data, error, mutate } = useClientDataSWR(
    isLogin ? recentKeys.topicList(MOBILE_RECENT_TOPIC_LIMIT, scope, 'mine') : null,
    () => recentService.getAll(MOBILE_RECENT_TOPIC_LIMIT, ['topic'], true, true),
    { revalidateOnFocus: false },
  );

  if (!isLogin || (!error && data?.length === 0)) return null;

  return (
    <CollapseGroup
      defaultActiveKey={[RECENT_TOPICS_KEY]}
      items={[
        {
          children: error ? (
            <AsyncError error={error} variant={'inline'} onRetry={mutate} />
          ) : data ? (
            <Flexbox gap={1} paddingInline={4}>
              {data.map((topic) => (
                <WorkspaceLink
                  key={topic.id}
                  style={{ color: 'inherit', textDecoration: 'none' }}
                  to={topic.routePath}
                >
                  <RecentListItem {...topic} />
                </WorkspaceLink>
              ))}
            </Flexbox>
          ) : (
            <SkeletonList rows={3} />
          ),
          key: RECENT_TOPICS_KEY,
          label: t('topic.recent'),
        },
      ]}
    />
  );
});

RecentTopics.displayName = 'MobileRecentTopics';

export default RecentTopics;
