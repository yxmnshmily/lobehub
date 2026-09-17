import { useDebounceFn } from 'ahooks';
import { Input } from 'antd';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { localizeGoalTemplate } from '@/features/EditorCanvas/localizeGoalTemplate';
import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { styles } from '../shared/style';

const DEBOUNCE_MS = 300;

const TaskDetailTitleInput = memo(({ compact = false }: { compact?: boolean }) => {
  const { t, i18n } = useTranslation('chat');
  const { allowed: canEditTask } = usePermission('create_content');
  const name = useTaskStore(taskDetailSelectors.activeTaskName);
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const updateTask = useTaskStore((s) => s.updateTask);

  const displayName = localizeGoalTemplate(name ?? '', i18n.resolvedLanguage || i18n.language);
  const [localName, setLocalName] = useState(displayName);

  useEffect(() => {
    setLocalName(displayName);
  }, [displayName]);

  const { run: debouncedSave } = useDebounceFn(
    (value: string) => {
      if (!canEditTask) return;
      if (taskId) updateTask(taskId, { name: value });
    },
    { wait: DEBOUNCE_MS },
  );

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setLocalName(e.target.value);
      debouncedSave(e.target.value);
    },
    [debouncedSave],
  );

  return (
    <Input.TextArea
      autoSize={{ minRows: 1 }}
      className={styles.titleInput}
      disabled={!canEditTask}
      placeholder={t('taskDetail.titlePlaceholder')}
      style={compact ? { fontSize: 20, padding: 0 } : undefined}
      value={localName}
      variant={'borderless'}
      onChange={handleNameChange}
    />
  );
});

export default TaskDetailTitleInput;
