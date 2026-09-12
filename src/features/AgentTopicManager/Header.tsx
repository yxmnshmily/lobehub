'use client';

import { Icon, Input } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import { useMobileGroupSidebar } from '@/features/SuperGroup/useMobileGroupSidebar';
import { useIsMobile } from '@/hooks/useIsMobile';

import { useTopicsViewStore } from './store';

interface HeaderProps {
  agentId: string;
  breadcrumb?: ReactNode;
}

const Header = memo<HeaderProps>(({ agentId, breadcrumb }) => {
  const { t } = useTranslation('topic');
  const search = useTopicsViewStore((s) => s.search);
  const setSearch = useTopicsViewStore((s) => s.setSearch);
  const groupSidebar = useMobileGroupSidebar();
  const mobileGroupHeader = useIsMobile() && !!breadcrumb;

  return (
    <NavHeader
      showTogglePanelButton={!mobileGroupHeader}
      left={
        <>
          {mobileGroupHeader && groupSidebar && (
            <ActionIcon
              aria-expanded={groupSidebar.open}
              aria-label={groupSidebar.open ? '收起侧栏' : '展开侧栏'}
              icon={groupSidebar.open ? PanelLeftClose : PanelLeftOpen}
              style={{ height: 44, width: 44 }}
              title={groupSidebar.open ? '收起侧栏' : '展开侧栏'}
              onClick={groupSidebar.toggle}
            />
          )}
          {breadcrumb ?? <AgentBreadcrumb agentId={agentId} title={t('management.title')} />}
        </>
      }
      right={
        <Input
          placeholder={t('searchPlaceholder')}
          prefix={<Icon icon={Search} size={'small'} style={{ marginInlineEnd: 4 }} />}
          size={'small'}
          value={search}
          variant={'filled'}
          onChange={(e) => setSearch(e.target.value)}
        />
      }
      styles={{
        left: { minWidth: 0, paddingInlineStart: mobileGroupHeader ? 0 : 8 },
        right: { flex: 1, maxWidth: 400, minWidth: 0 },
      }}
    />
  );
});

Header.displayName = 'AgentTopicManagerHeader';

export default Header;
