'use client';

import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingContainer from '@/features/Setting/SettingContainer';
import { usePermission } from '@/hooks/usePermission';

import { createCreateCredModal } from './features/CreateCredModal';
import CredsList from './features/CredsList';
import { useCredsApi } from './features/useCredsApi';

interface PageProps {
  mobile?: boolean;
}

const Page = ({ mobile }: PageProps) => {
  const { t } = useTranslation('setting');
  const { allowed: canManageCredentials, reason } = usePermission('manage_provider_key');
  const [refreshKey, setRefreshKey] = useState(0);
  const credsApi = useCredsApi();

  const handleCreate = () => {
    if (!canManageCredentials) return;
    createCreateCredModal({
      credsApi,
      onSuccess: () => setRefreshKey((k) => k + 1),
    });
  };

  const createButton = (
    /* Centred and capped: a primary button stretched across the whole pane
       reads as a banner, not a button. */
    <Flexbox horizontal justify={'center'} width={'100%'}>
      <div style={{ maxWidth: 480, width: '100%' }}>
        <Tooltip title={reason}>
          <Button
            disabled={!canManageCredentials}
            icon={<Icon icon={Plus} />}
            size={mobile ? 'large' : 'small'}
            style={{ width: '100%' }}
            type={'primary'}
            onClick={handleCreate}
          >
            {t('creds.create')}
          </Button>
        </Tooltip>
      </div>
    </Flexbox>
  );

  if (mobile) {
    return (
      <>
        <Flexbox horizontal justify={'flex-end'} padding={16}>
          {createButton}
        </Flexbox>
        <CredsList key={refreshKey} />
      </>
    );
  }

  return (
    <>
      <SettingContainer maxWidth={'100%'}>
        {createButton}
        <CredsList key={refreshKey} />
      </SettingContainer>
    </>
  );
};

Page.displayName = 'CredsSetting';

export default Page;
