import { resolveGroupDiscussionMaxRounds } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  hint: css`
    max-width: 640px;
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  label: css`
    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  row: css`
    padding-block: 20px;
    padding-inline: 4px;
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
  `,
}));

export function GroupDiscussionSettings({
  disabled = false,
  groupId,
}: {
  disabled?: boolean;
  groupId: string;
}) {
  const { t } = useTranslation('chat');
  const hintId = useId();
  const inputId = useId();
  const group = useAgentGroupStore((s) => agentGroupSelectors.getGroupById(groupId)(s));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const save = async (value: number) => {
    if (disabled || saving) return;
    const store = useAgentGroupStore.getState();
    const current = agentGroupSelectors.getGroupById(groupId)(store);
    if (!current) return;
    setSaving(true);
    setFailed(false);
    try {
      await store.updateGroup(groupId, {
        config: { maxDiscussionRounds: value },
      });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox aria-describedby={hintId} className={styles.row} gap={8} role="group">
      <Flexbox
        horizontal
        align="center"
        gap={16}
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <label className={styles.label} htmlFor={inputId}>
          {t('groupDiscussion.maxRounds')}
        </label>
        <Select
          disabled={disabled || saving || !group}
          id={inputId}
          options={Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1), value: i + 1 }))}
          style={{ minWidth: 100 }}
          value={resolveGroupDiscussionMaxRounds(group?.config?.maxDiscussionRounds)}
          onChange={save}
        />
      </Flexbox>
      <span className={styles.hint} id={hintId}>
        {t('groupDiscussion.hint')}
      </span>
      {saving && <span role="status">{t('groupDiscussion.saving')}</span>}
      {failed && (
        <span role="alert" style={{ color: cssVar.colorError }}>
          {t('groupDiscussion.saveError')}
        </span>
      )}
    </Flexbox>
  );
}
