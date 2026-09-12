import { Play } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';

export const ttsAction = defineAction({
  key: 'tts',
  useBuild: (ctx) => {
    const { t } = useTranslation('chat');
    const startMessageTTS = useConversationStore((s) => s.startMessageTTS);
    const targetId = ctx.role === 'group' ? ctx.contentBlock?.id : ctx.id;

    return useMemo(
      () =>
        targetId
          ? {
              handleClick: () => startMessageTTS(targetId),
              icon: Play,
              key: 'tts',
              label: t('tts.action'),
            }
          : null,
      [t, targetId, startMessageTTS],
    );
  },
});
