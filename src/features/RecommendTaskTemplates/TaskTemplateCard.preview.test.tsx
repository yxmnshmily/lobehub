import type { TaskTemplate } from '@lobechat/const';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { TaskTemplateCard } from './TaskTemplateCard';

const actions = vi.hoisted(() => ({ create: vi.fn(), preview: vi.fn() }));
vi.mock('./TaskTemplateDetailModal', () => ({ createTaskTemplateDetailModal: actions.preview }));
vi.mock('./useTaskTemplateCreate', () => ({
  useTaskTemplateCreate: () => ({
    handleAddTask: actions.create,
    primaryButtonLabel: '添加任务',
    disabled: false,
  }),
}));
vi.mock('./useVisibleAuthSpecs', () => ({ useVisibleAuthSpecs: () => [] }));
vi.mock('./useScheduleText', () => ({ useScheduleText: () => '每天 09:00' }));

it('opens the template preview before creation when requested by the task page', () => {
  const template = {
    id: 1,
    identifier: 'arxiv',
    category: 'engineering',
    title: 'ArXiv 精选',
    description: '最新论文',
    instruction: '筛选论文',
    cronPattern: '0 9 * * *',
    connectors: [],
    interests: [],
  } satisfies TaskTemplate;
  render(
    <TaskTemplateCard
      previewBeforeCreate
      template={template}
      onCreated={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '添加任务' }));
  expect(actions.preview).toHaveBeenCalledWith(expect.objectContaining({ template }));
  expect(actions.create).not.toHaveBeenCalled();
});
