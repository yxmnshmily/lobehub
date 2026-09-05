'use client';

import { useMatches, useParams } from 'react-router';

import Footer from '@/features/Setting/Footer';
import SettingsContent from '@/features/Settings/features/SettingsContent';

import { resolveMobileSettingsTab } from './resolveActiveTab';

const MobileSettingsPage = () => {
  const params = useParams<{ tab?: string }>();
  const matches = useMatches();
  const activeTab = resolveMobileSettingsTab(params.tab, matches);

  return (
    <>
      <SettingsContent activeTab={activeTab} mobile={true} />
      <Footer />
    </>
  );
};

export default MobileSettingsPage;
