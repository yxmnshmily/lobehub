import SkeletonBar from '@/components/Skeleton/Bar';
import { Alert, Button } from '@lobehub/ui/base-ui';
import { RotateCcw } from 'lucide-react';
import { memo, Suspense, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
} from '@/features/Conversation/store';

import { type ChatItemProps } from '../type';

export interface ErrorContentProps {
  customErrorRender?: ChatItemProps['customErrorRender'];
  error: ChatItemProps['error'];
  id?: string;
  onRegenerate?: () => Promise<void> | void;
}

const ErrorContent = memo<ErrorContentProps>(({ customErrorRender, error, id, onRegenerate }) => {
  const { t } = useTranslation('common');
  const [deleteMessage, updateMessageError] = useConversationStore((s) => [
    s.deleteMessage,
    s.updateMessageError,
  ]);
  const messageContent = useConversationStore((s) =>
    id ? dataSelectors.getDisplayMessageById(id)(s)?.content : undefined,
  );
  // The retry can take a while to produce anything visible (branch switch plus a
  // transport round trip), so the button has to own its own pending state —
  // otherwise a click reads as "nothing happened" and invites a second one.
  const operationRetrying = useConversationStore((s) =>
    id ? messageStateSelectors.isMessageRegenerating(id)(s) : false,
  );
  const [retryPending, setRetryPending] = useState(false);
  const retryPendingRef = useRef(false);
  const retrying = operationRetrying || retryPending;
  const handleRegenerate = useCallback(async () => {
    if (!onRegenerate || operationRetrying || retryPendingRef.current) return;

    retryPendingRef.current = true;
    setRetryPending(true);
    try {
      await onRegenerate();
    } finally {
      retryPendingRef.current = false;
      setRetryPending(false);
    }
  }, [onRegenerate, operationRetrying]);

  if (!error) return;

  if (customErrorRender) {
    return <Suspense fallback={<SkeletonBar height={36} />}>{customErrorRender(error)}</Suspense>;
  }

  return (
    <Alert
      closable
      extraDefaultExpand
      showIcon
      extraIsolate={false}
      type={'secondary'}
      action={
        onRegenerate && (
          <Button
            disabled={retrying}
            icon={<RotateCcw size={14} />}
            loading={retrying}
            size="small"
            type="fill"
            onClick={handleRegenerate}
          >
            {t('regenerate')}
          </Button>
        )
      }
      {...error}
      title={error.message}
      afterClose={() => {
        error?.afterClose?.();
        if (!id) return;
        // A turn can carry a terminal error on top of content it already
        // streamed. Dismissing the error must not delete that content — just
        // clear the error and keep the message.
        if (messageContent && messageContent.trim() !== '') {
          updateMessageError(id, null);
        } else {
          deleteMessage(id);
        }
      }}
      style={{
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
        ...error.style,
      }}
    />
  );
});

export default ErrorContent;
