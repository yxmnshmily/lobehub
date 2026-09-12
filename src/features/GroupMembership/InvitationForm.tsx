'use client';

import { Flexbox, Input } from '@lobehub/ui';
import { Alert, Button } from '@lobehub/ui/base-ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';

export default function InvitationForm({
  groupId,
  disabled = false,
}: {
  groupId: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation('chat');
  const [contact, setContact] = useState('');
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<'success' | 'error'>();
  const inFlight = useRef(false);
  const query = lambdaQuery.groupMembership.listParticipants.useQuery(
    { groupId, limit: 50, offset: 0 },
    { retry: false },
  );
  const invite = lambdaQuery.groupMembership.createInvitation.useMutation();
  if (query.data?.viewerRole !== 'owner' || query.isError) return null;
  const busy = disabled || pending;
  const label = t('groupMembership.contact', { defaultValue: 'User ID, phone number or email' });

  return (
    <Flexbox gap={8}>
      <form
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, width: '100%' }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || inFlight.current || !contact.trim()) return;
          inFlight.current = true;
          setPending(true);
          setFeedback(undefined);
          try {
            await invite.mutateAsync({ groupId, contact: contact.trim() });
            setContact('');
            setFeedback('success');
          } catch {
            setFeedback('error');
          } finally {
            inFlight.current = false;
            setPending(false);
          }
        }}
      >
        <Input
          required
          aria-label={label}
          autoCapitalize="none"
          autoComplete="off"
          disabled={busy}
          maxLength={320}
          placeholder={label}
          spellCheck={false}
          style={{ flex: '1 1 180px', minWidth: 0, height: 36, fontSize: 14, borderRadius: 8 }}
          type="text"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
        />
        <Button
          disabled={busy || !contact.trim()}
          htmlType="submit"
          loading={pending}
          style={{ height: 36, paddingInline: 14, fontSize: 13, borderRadius: 8, flexShrink: 0 }}
        >
          {t('groupMembership.invite', { defaultValue: 'Send invitation' })}
        </Button>
      </form>
      {feedback && (
        <Alert
          showIcon
          type={feedback}
          title={
            feedback === 'success'
              ? t('groupMembership.invited', {
                  defaultValue: 'Invitation sent. They will join after accepting.',
                })
              : t('groupMembership.inviteError', {
                  defaultValue:
                    'Invitation could not be sent. Check the registered contact and try again.',
                })
          }
        />
      )}
    </Flexbox>
  );
}
