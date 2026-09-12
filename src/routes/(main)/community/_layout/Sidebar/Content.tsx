'use client';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import SettingsBody from '@/features/Settings/Layout/Body';
import SettingsHeader from '@/features/Settings/Layout/Header';

const Content = () => {
  return <SideBarLayout body={<SettingsBody />} header={<SettingsHeader />} />;
};

export default Content;
