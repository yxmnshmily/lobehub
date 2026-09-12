import { Icon } from '@lobehub/ui';
import { Map } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

export default function useBusinessMenuItems(isSignin: boolean | undefined) {
  const { t } = useTranslation('common');
  return isSignin
    ? [
        {
          icon: <Icon icon={Map} />,
          key: 'upgrade-plan',
          label: (
            <WorkspaceLink escape to="/settings/plans">
              {t('userPanel.upgradePlan')}
            </WorkspaceLink>
          ),
        },
      ]
    : [];
}
