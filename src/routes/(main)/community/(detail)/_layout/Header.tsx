'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useLocation } from 'react-router';
import urlJoin from 'url-join';

import NavHeader from '@/features/NavHeader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import Nav from '@/routes/(main)/community/_layout/Sidebar/Header/Nav';
import StoreSearchBar from '@/routes/(main)/community/features/Search';
import UserAvatar from '@/routes/(main)/community/features/UserAvatar';
import { useDiscoverStore } from '@/store/discover';

import { styles } from './Header/style';

const Header = memo(() => {
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const path = location.pathname.split('/').filter(Boolean);
  const communityIndex = path.indexOf('community');
  const detailType = communityIndex >= 0 ? path[communityIndex + 1] : undefined;
  const detailSlug = communityIndex >= 0 ? path[communityIndex + 2] : undefined;
  const profileUsername =
    (detailType === 'user' || detailType === 'org') && detailSlug
      ? decodeURIComponent(detailSlug)
      : '';

  const useUserProfile = useDiscoverStore((s) => s.useUserProfile);
  const { data: detailProfile } = useUserProfile({ username: profileUsername });
  const detailAvatar =
    detailProfile?.user.avatarUrl || detailProfile?.user.userName || detailProfile?.user.namespace;

  const handleGoBack = () => {
    // group_agent goes back to agent list page
    if (detailType === 'group_agent') {
      navigate('/community/agent');
      return;
    }

    // Types that have their own list pages
    const typesWithListPage = ['agent', 'model', 'provider', 'mcp', 'skill'];

    if (detailType && typesWithListPage.includes(detailType)) {
      navigate(urlJoin('/community', detailType));
    } else {
      // For user or any other type without a list page
      navigate('/community');
    }
  };

  const cssVariables: Record<string, string> = {
    '--header-border-color': cssVar.colorBorderSecondary,
  };

  /* 两行结构（与列表页头部一致）：第一行返回+搜索+头像，第二行整排栏目导航，
     避免窄屏下导航被搜索框挤压截断。 */
  return (
    <Flexbox className={styles.headerContainer} gap={0} style={cssVariables}>
      <NavHeader
        height={44}
        left={<ActionIcon icon={ArrowLeft} size={'small'} onClick={handleGoBack} />}
        paddingInline={16}
        styles={{ right: { flex: 1, minWidth: 0, justifyContent: 'flex-end' } }}
        right={
          <>
            <StoreSearchBar />
            <UserAvatar avatarOverride={detailAvatar} />
          </>
        }
      />
      <Flexbox style={{ width: '100%', paddingBlock: '6px 8px', paddingInline: 16 }}>
        <Nav />
      </Flexbox>
    </Flexbox>
  );
});

export default Header;
