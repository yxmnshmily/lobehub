'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useLocation } from 'react-router';

import NavHeader from '@/features/NavHeader';
import Nav from '@/routes/(main)/community/_layout/Sidebar/Header/Nav';
import StoreSearchBar from '@/routes/(main)/community/features/Search';
import UserAvatar from '@/routes/(main)/community/features/UserAvatar';

import SortButton from '../features/SortButton';
import { styles } from './Header/style';

const Header = memo(() => {
  const location = useLocation();
  const isHome = location.pathname === '/';

  const cssVariables: Record<string, string> = {
    '--header-border-color': cssVar.colorBorderSecondary,
  };

  /* 两行结构：第一行搜索/排序/头像，第二行整排栏目导航。之前挤在一行，
     窄屏下导航被搜索框挤压截断（只能看到前几个 tab）。 */
  return (
    <Flexbox className={styles.headerContainer} gap={0} style={cssVariables}>
      <NavHeader
        height={44}
        paddingInline={16}
        styles={{ right: { flex: 1, minWidth: 0, justifyContent: 'flex-end' } }}
        right={
          <>
            <StoreSearchBar />
            {!isHome && <SortButton />}
            {!isHome && <UserAvatar />}
          </>
        }
      />
      {/* 必须限定在可见宽度内（width 100% 而非 flex none），否则 Nav 会被
          内容撑开、超出视口的 tab 点不到；Nav 自带 overflow-x 滑动。 */}
      <Flexbox style={{ width: '100%', paddingBlock: '6px 8px', paddingInline: 16 }}>
        <Nav />
      </Flexbox>
    </Flexbox>
  );
});

export default Header;
