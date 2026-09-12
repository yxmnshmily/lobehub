'use client';

import { Outlet, useMatch } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import SettingsContextProvider from '@/features/Settings/Layout/ContextProvider';
import SettingsSideBar from '@/features/Settings/Layout/SideBar';

import Header from './Header';
import PersonalSettingsScaffold from './PersonalSettingsScaffold';

const MobileSettingsWrapper = () => {
  const workspaceSettingsMatch = useMatch('/:workspaceSlug/settings/*');

  const content = workspaceSettingsMatch ? (
    <MobileContentLayout header={<Header />}>
      <Outlet />
    </MobileContentLayout>
  ) : (
    <PersonalSettingsScaffold header={<Header />}>
      <Outlet />
    </PersonalSettingsScaffold>
  );

  return (
    <SettingsContextProvider
      value={{
        showOpenAIApiKey: true,
        showOpenAIProxyUrl: true,
      }}
    >
      <SettingsSideBar />
      {content}
    </SettingsContextProvider>
  );
};

export default MobileSettingsWrapper;
