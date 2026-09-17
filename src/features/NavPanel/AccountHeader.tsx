'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { House } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import InboxButton from '@/features/HomeSidebar/Header/components/InboxButton';
import User from '@/features/HomeSidebar/Header/components/User';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import SideBarHeaderLayout from './SideBarHeaderLayout';

/** One account menu and notification entry owned by the navigation shell. */
export default function AccountHeader({ compact = false }: { compact?: boolean }) {
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation('common');
  return (
    <SideBarHeaderLayout
      left={<User lite={compact} />}
      showBack={false}
      showTogglePanelButton={false}
      right={
        <Flexbox horizontal align="center" data-nav-expanded-only="" gap={2}>
          <InboxButton />
          <ActionIcon
            aria-label={t('backToHome')}
            icon={House}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('backToHome')}
            onClick={() => navigate('/group/default')}
          />
        </Flexbox>
      }
    />
  );
}
