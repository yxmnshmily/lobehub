'use client';

import { AppWindow } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import { getTabRouterIds } from '@/features/Electron/TabHost/tabRouterManager';
import { useElectronStore } from '@/store/electron';

import { useDevDockStore } from '../store';
import BarButton from './BarButton';

const TabRoutersWidget = memo(() => {
  const tabCount = useElectronStore((s) => s.tabs.length);
  const togglePanel = useDevDockStore((s) => s.togglePanel);
  const [liveCount, setLiveCount] = useState(() => getTabRouterIds().length);

  useEffect(() => {
    const timer = setInterval(() => setLiveCount(getTabRouterIds().length), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <BarButton
      icon={AppWindow}
      label={`${liveCount}/${tabCount}`}
      title={'活动标签页路由 / 已打开标签页'}
      onClick={() => togglePanel('tab-routers')}
    />
  );
});

TabRoutersWidget.displayName = 'DevDockTabRoutersWidget';

export default TabRoutersWidget;
