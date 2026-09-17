import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../store';
import ProcessFold from '../AssistantGroup/components/ProcessFold';

/** Fold explicitly typed internal content only; never inspect user/answer text. */
const GroupProcessDetails = memo(({ children }: { children: ReactNode }) => {
  const groupId = useConversationStore((s) => s.context?.groupId);
  const { t } = useTranslation('chat');

  return groupId ? (
    <ProcessFold stepCount={0} title={t('groupProcess.details')}>
      {children}
    </ProcessFold>
  ) : (
    children
  );
});

export default GroupProcessDetails;
