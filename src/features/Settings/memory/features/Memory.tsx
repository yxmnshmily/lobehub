'use client';

import { type UserMemoryEffort } from '@lobechat/types';
import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Tooltip } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonText from '@/components/Skeleton/Text';
import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { FORM_STYLE } from '@/const/layoutTokens';
import LevelSlider from '@/features/ModelSwitchPanel/components/ControlsForm/LevelSlider';
import { usePermission } from '@/hooks/usePermission';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

const MEMORY_EFFORT_LEVELS: readonly UserMemoryEffort[] = ['low', 'medium', 'high'];

const MemorySetting = memo(() => {
  const { t } = useTranslation('setting');
  const { allowed: canManageMemory, reason } = usePermission('manage_settings');
  const [form] = Form.useForm();
  const memory = useUserStore(settingsSelectors.currentMemorySettings, isEqual);
  const memoryEnabled = useUserStore(settingsSelectors.memoryEnabled);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();

  if (!isUserStateInit) return <SkeletonText rows={3} />;

  const memoryEnabledSwitch = (
    <Switch disabled={!canManageMemory} title={t('memory.enabled.title')} />
  );

  const memorySettings: FormGroupItemType = {
    children: [
      {
        children: canManageMemory ? (
          memoryEnabledSwitch
        ) : (
          <Tooltip title={reason}>{memoryEnabledSwitch}</Tooltip>
        ),
        desc: t('memory.enabled.desc'),
        label: t('memory.enabled.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enabled',
        tooltip: reason,
        valuePropName: 'checked',
      },
      {
        children: (
          <Tooltip title={reason}>
            <LevelSlider<UserMemoryEffort>
              defaultValue="medium"
              disabled={!canManageMemory}
              levels={MEMORY_EFFORT_LEVELS}
              style={{ minWidth: 160 }}
              value={memory.effort}
              marks={{
                0: t('memory.effort.level.low'),
                1: t('memory.effort.level.medium'),
                2: t('memory.effort.level.high'),
              }}
              onChange={(value) => {
                if (!canManageMemory) return;

                save(() => setSettings({ memory: { effort: value } }));
              }}
            />
          </Tooltip>
        ),
        desc: t('memory.effort.desc'),
        label: t('memory.effort.title'),
        layout: 'horizontal',
        minWidth: undefined,
      },
    ],
    extra: <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />,
    title: t('memory.title'),
  };

  return (
    <div>
      <Form
        collapsible={false}
      form={form}
      initialValues={{ ...memory, enabled: memoryEnabled }}
      items={[memorySettings]}
      itemsType={'group'}
      variant={'filled'}
      onValuesChange={(values) => {
        if (!canManageMemory) return;

        save(() => setSettings({ memory: values }));
      }}
        {...FORM_STYLE}
      />
    </div>
  );
});

export default MemorySetting;
