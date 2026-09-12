import { copyToClipboard } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { Copy } from 'lucide-react';
import { use, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGroupMessageContent } from '@/features/SuperGroup/GroupAgentQuote';
import { GroupChatPresentation } from '@/features/SuperGroup/GroupChatPresentation';

import { defineAction } from '../defineAction';
import { getMessageDownloads, getMessageExportText } from '../messageDownloads';

export const copyAction = defineAction({
  key: 'copy',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');
    const groupChat = use(GroupChatPresentation);
    const raw = getMessageExportText(ctx.data, { stripGroupQuote: groupChat });
    const reply = useGroupMessageContent(raw);

    return useMemo(() => {
      const content = reply.content;

      return {
        handleClick: async () => {
          try {
            const text =
              content ||
              getMessageDownloads(ctx.data)
                .map((file) => file.url)
                .join('\n');
            if (!text.trim()) {
              toast.info('这条消息暂无可复制的内容。');
              return;
            }
            await copyToClipboard(text);
          } catch {
            toast.error('复制失败，请重试。');
            return;
          }
          toast.success(t('copySuccess'));
        },
        icon: Copy,
        key: 'copy',
        label: t('copy'),
      };
    }, [t, ctx.data, reply.content]);
  },
});
