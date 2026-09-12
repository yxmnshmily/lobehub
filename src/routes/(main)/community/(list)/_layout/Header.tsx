'use client';

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

  return (
    <NavHeader
      className={styles.headerContainer}
      height={64}
      left={<Nav />}
      style={cssVariables}
      right={
        <>
          <StoreSearchBar />
          {!isHome && <SortButton />}
          {!isHome && <UserAvatar />}
        </>
      }
      styles={{
        left: { flex: 1, minWidth: 0 },
        right: { flex: '0 1 360px', minWidth: 140 },
      }}
    />
  );
});

export default Header;
