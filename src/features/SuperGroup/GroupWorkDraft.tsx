'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { useId, useState } from 'react';

import { useTravelTranslation } from '@/utils/i18n/travel';

import type { GroupWorkKind } from './groupWorkEntries';

/** A group request draft, not the personal goal/task creation API. */
export default function GroupWorkDraft({
  kind,
  onDraft,
}: {
  kind: GroupWorkKind;
  onDraft: (text: string) => void;
}) {
  const t = useTravelTranslation();
  const id = useId();
  const [description, setDescription] = useState('');
  const label = kind === 'goals' ? t('你期望达到的目标') : t('你想制定的任务');
  return (
    <Flexbox gap={16}>
      <label htmlFor={id}>{label}</label>
      <textarea
        autoFocus
        id={id}
        maxLength={12000}
        placeholder={t('写清结果、范围和验收标准，可补充负责人和时间要求。')}
        rows={7}
        value={description}
        style={{
          width: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
          resize: 'vertical',
          padding: 12,
          border: `0.5px solid ${cssVar.colorBorder}`,
          borderRadius: 8,
          background: cssVar.colorBgContainer,
          color: cssVar.colorText,
          font: 'inherit',
        }}
        onChange={(event) => setDescription(event.target.value)}
      />
      <Text type="secondary">
        {t('先填入当前群聊草稿，由你检查后发送；不会在此创建个人项目或自动开始执行。')}
      </Text>
      <Button
        disabled={!description.trim()}
        style={{ alignSelf: 'flex-end' }}
        onClick={() =>
          onDraft(
            `${kind === 'goals' ? t('设定一个目标') : t('制定一个任务')}\n\n${description.trim()}`,
          )
        }
      >
        {t('填入群聊草稿')}
      </Button>
    </Flexbox>
  );
}
