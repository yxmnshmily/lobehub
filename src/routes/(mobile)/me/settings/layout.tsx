import { Outlet } from 'react-router';

import PersonalSettingsScaffold from '@/routes/(mobile)/settings/_layout/PersonalSettingsScaffold';

import Header from './features/Header';

const Layout = () => {
  return (
    <PersonalSettingsScaffold header={<Header />}>
      <Outlet />
    </PersonalSettingsScaffold>
  );
};

export default Layout;
