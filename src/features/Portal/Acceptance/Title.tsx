import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceBundle } from '@/features/Acceptance/hooks';
import { localizeGoalTemplate } from '@/features/EditorCanvas/localizeGoalTemplate';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Title = memo(() => {
  const { t, i18n } = useTranslation('verify');
  const acceptanceId = useChatStore(chatPortalSelectors.acceptancePortalId);
  const { data } = useAcceptanceBundle(acceptanceId ?? null);

  return localizeGoalTemplate(
    data?.subject.title || t('acceptance.titleFallback'),
    i18n.resolvedLanguage || i18n.language,
  );
});

export default Title;
