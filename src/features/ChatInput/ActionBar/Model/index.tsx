import { Tooltip } from '@lobehub/ui';
import { memo, use, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ModelIcon } from '@/components/LobeIcons';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

import SelectorTrigger from '../../components/SelectorTrigger';
import { useAgentId } from '../../hooks/useAgentId';
import { useAgentModelSelection } from '../../hooks/useAgentModelSelection';
import { useModelLockTooltip } from '../../hooks/useModelLockTooltip';
import { useReasoningEffortControl } from '../../hooks/useReasoningEffortControl';
import { getRuntimeModelLabel, RuntimeModelContext } from '../../RuntimeModelContext';
import { useActionBarContext } from '../context';
import SelectorMenu from './SelectorMenu';

const ModelSwitch = memo(() => {
  const { t } = useTranslation('chat');
  const { dropdownPlacement } = useActionBarContext();
  const agentId = useAgentId();
  const {
    canDisplayModel,
    canSelectModel,
    isGroupContext,
    model: agentModel,
    provider: agentProvider,
    selectionLockReason,
    selectModel,
  } = useAgentModelSelection(agentId);
  // Topic-scoped model: a topic pins its own model (top-level `topics.model`
  // column). Display the topic's pinned model when present, else the agent
  // default; a switch pins to the active topic, otherwise updates the agent
  // (via selectModel, which honors workspace member overrides).
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const hasTopic = useChatStore(
    (s) => !!s.activeTopicId && !!topicSelectors.getTopicById(s.activeTopicId)(s),
  );
  const useFetchTopicDetail = useChatStore((s) => s.useFetchTopicDetail);
  // Group conversations can open without mounting the topic sidebar/list.
  // Hydrate the pin before relying on its cache for display and optimistic writes.
  useFetchTopicDetail(hasTopic ? undefined : activeTopicId);
  const topicModel = useChatStore(topicSelectors.activeTopicModel);
  const updateTopicModel = useChatStore((s) => s.updateTopicModel);
  const model = topicModel?.model ?? agentModel;
  const provider = topicModel?.model ? topicModel.provider : agentProvider;

  const enabledModel = useAiInfraStore(aiModelSelectors.getEnabledModelById(model, provider));
  const displayName = enabledModel?.displayName || model;
  const lockTooltip = useModelLockTooltip(displayName, selectionLockReason);
  // Reasoning effort rides along with the model trigger instead of claiming a
  // second action slot. Like the model, it pins to the active topic when there
  // is one and edits the user's per-model default otherwise.
  const effort = useReasoningEffortControl(model, provider, activeTopicId ?? undefined);
  // A pinned model still opens the menu when there is an effort to pick there.
  const interactive = canSelectModel || effort.hasReasoningParams;

  const handleModelChange = useCallback(
    async (params: { model: string; provider: string }) => {
      if (!canSelectModel) return;

      if (activeTopicId) await updateTopicModel(activeTopicId, params);
      else await selectModel(params);
    },
    [activeTopicId, canSelectModel, selectModel, updateTopicModel],
  );

  // Both current values on one chip, the way the heterogeneous selector reads:
  // "GPT-5.6 Sol 中". The effort half is dropped for models without one; the
  // chip keeps the two halves apart so the effort is never ellipsised away.
  const effortLabel = effort.effortValue
    ? t(`reasoningEffort.levels.${effort.effortValue}`)
    : undefined;
  const triggerText = effortLabel ? `${displayName} ${effortLabel}` : displayName;

  const scopeLabel = isGroupContext ? t('modelSelector.supervisor') : t('modelSelector.model');
  const scopeHint = isGroupContext
    ? t(activeTopicId ? 'modelSelector.supervisorTopicHint' : 'modelSelector.supervisorDefaultHint')
    : undefined;

  const trigger = (
    <SelectorTrigger
      aria-disabled={!interactive}
      ariaLabel={isGroupContext ? `${scopeLabel}：${triggerText}` : triggerText}
      modelIcon={<ModelIcon model={model} size={16} />}
      scopeLabel={isGroupContext ? scopeLabel : undefined}
      secondaryText={effortLabel}
      text={displayName}
      title={scopeHint}
      {...(interactive ? {} : { style: { cursor: 'default' } })}
    />
  );

  if (!canDisplayModel) return null;

  // Model + effort in one menu, so the two settings that decide how a turn runs
  // are picked in the same place (see SelectorMenu).
  if (effort.hasReasoningParams)
    return (
      <SelectorMenu
        canSelectModel={canSelectModel}
        displayName={displayName}
        effort={effort}
        model={model}
        modelLabel={scopeLabel}
        placement={dropdownPlacement ?? 'topRight'}
        provider={provider}
        onModelChange={handleModelChange}
      >
        {trigger}
      </SelectorMenu>
    );

  // Locked: say which model is pinned AND why it can't be changed here — the
  // bare model name used to leave the inert chip unexplained.
  if (!canSelectModel) return <Tooltip title={lockTooltip ?? displayName}>{trigger}</Tooltip>;

  return (
    <ModelSwitchPanel
      model={model}
      openOnHover={false}
      placement={dropdownPlacement ?? 'topRight'}
      provider={provider}
      onModelChange={handleModelChange}
    >
      {trigger}
    </ModelSwitchPanel>
  );
});

ModelSwitch.displayName = 'ModelSwitch';

export default function ScopedModelSwitch() {
  const runtimeModel = use(RuntimeModelContext);
  if (!runtimeModel) return <ModelSwitch />;
  const label = getRuntimeModelLabel(runtimeModel);
  const canRetry = runtimeModel.status === 'error' && !!runtimeModel.retry;
  return (
    <Tooltip title={canRetry ? label : '群模型由管理员统一配置'}>
      <SelectorTrigger
        aria-disabled={!canRetry}
        ariaLabel={label}
        modelIcon={
          runtimeModel.model ? <ModelIcon model={runtimeModel.model} size={16} /> : undefined
        }
        role={canRetry ? 'button' : undefined}
        tabIndex={canRetry ? 0 : undefined}
        text={label}
        onClick={canRetry ? runtimeModel.retry : undefined}
        onKeyDown={
          canRetry
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  runtimeModel.retry?.();
                }
              }
            : undefined
        }
      />
    </Tooltip>
  );
}
