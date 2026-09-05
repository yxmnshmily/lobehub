'use client';

import { ActionIcon } from '@lobehub/ui/base-ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { ChevronLeft } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatch } from 'react-router';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

const Header = memo(() => {
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation('common');
  const workspaceMatch = useMatch('/:workspaceSlug/community/*');
  const workspaceSlug = workspaceMatch?.params.workspaceSlug;
  const communityRoot = workspaceSlug ? `/${workspaceSlug}/community` : '/community';

  return (
    <ChatHeader
      style={mobileHeaderSticky}
      left={
        <ActionIcon
          aria-label={t('back')}
          icon={ChevronLeft}
          size={MOBILE_HEADER_ICON_SIZE}
          title={t('back')}
          onClick={() => navigate(communityRoot, { escape: true })}
        />
      }
    />
  );
});

export default Header;
