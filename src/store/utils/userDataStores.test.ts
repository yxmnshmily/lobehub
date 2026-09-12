import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyService } from '@/services/verify';
import { useAiInfraStore } from '@/store/aiInfra';
import { useBriefStore } from '@/store/brief';
import { useFollowUpActionStore } from '@/store/followUpAction';
import { useGoalStore } from '@/store/goal';
import { useGroupProfileStore } from '@/store/groupProfile';
import { useProjectStore } from '@/store/project';
import { useTopicCommentStore } from '@/store/topicComment';
import { useTreeStore } from '@/store/tree';
import { useVerifyStore } from '@/store/verify';

import { stores } from './userDataStores';

describe('userDataStores', () => {
  beforeEach(() => {
    useAiInfraStore.setState({
      activeAiProvider: 'private-provider',
      aiProviderDetailMap: {
        'private-provider': {
          config: { keyVaults: { apiKey: 'previous-user-secret' } },
        },
      } as never,
    });
    useFollowUpActionStore.setState({
      slots: {
        conversation: {
          chips: [{ label: 'Previous suggestion', message: 'previous user suggestion' }],
          status: 'ready',
        },
      },
    });
    useBriefStore.setState({
      briefs: [{ id: 'account-a-brief', title: 'Account A private brief' }] as never,
      briefsScope: 'account-a:personal',
      isBriefsInit: true,
    });
    useGoalStore.setState({
      goalListByAgentId: { 'account-a-agent': [{ id: 'account-a-goal' }] } as never,
      goalListInitializedAgentIds: ['account-a-agent'],
      homeGoalsByScope: { 'account-a:personal': [{ id: 'account-a-goal' }] } as never,
      homeGoalsInitializedScopes: ['account-a:personal'],
    });
    useGroupProfileStore.setState({
      activeTabId: 'account-a-agent',
      saveStateMap: { 'account-a-agent': { saveStatus: 'saving' } },
      streamingContent: 'Account A private profile draft',
      streamingInProgress: true,
    });
    useProjectStore.setState({
      projectDetails: {
        personal: {
          'account-a-project': {
            project: { id: 'account-a-project', name: 'Account A private project' },
          },
        },
      } as never,
      projectLists: {
        personal: [{ id: 'account-a-project', name: 'Account A private project' }],
      } as never,
    });
    useTopicCommentStore.setState({
      drafts: { private: { content: 'previous user draft' } },
    });
    useTreeStore.setState({
      children: {
        '': [
          {
            fileType: 'text/plain',
            id: 'private-file',
            isFolder: false,
            name: 'previous-user.txt',
            url: '',
          },
        ],
      },
      knowledgeBaseId: 'previous-user-library',
    });
    useVerifyStore.setState({
      acceptanceBundleMap: { 'account-a-acceptance': { id: 'account-a-acceptance' } } as never,
      criterionEdits: { 'account-a-criterion': { title: 'Account A private rubric' } },
      instructionEdits: { 'account-a-document': 'Account A private instruction' },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clears identity-scoped caches and credentials together', () => {
    stores.reset();

    expect(useAiInfraStore.getState().activeAiProvider).toBeUndefined();
    expect(useAiInfraStore.getState().aiProviderDetailMap).toEqual({});
    expect(useFollowUpActionStore.getState().slots).toEqual({});
    expect(useProjectStore.getState().projectDetails).toEqual({});
    expect(useProjectStore.getState().projectLists).toEqual({});
    expect(useTopicCommentStore.getState().drafts).toEqual({});
    expect(useTreeStore.getState().children).toEqual({});
    expect(useTreeStore.getState().knowledgeBaseId).toBeNull();
  });

  it('does not carry account A group profile draft into account B', () => {
    stores.reset();

    expect(useGroupProfileStore.getState().activeTabId).toBe('group');
    expect(useGroupProfileStore.getState().saveStateMap).toEqual({});
    expect(useGroupProfileStore.getState().streamingContent).toBeUndefined();
    expect(useGroupProfileStore.getState().streamingInProgress).toBe(false);
  });

  it('does not carry account A briefs into account B', () => {
    stores.reset();

    expect(useBriefStore.getState().briefs).toEqual([]);
    expect(useBriefStore.getState().briefsScope).toBeUndefined();
    expect(useBriefStore.getState().isBriefsInit).toBe(false);
  });

  it('does not carry account A goals into account B', () => {
    stores.reset();

    expect(useGoalStore.getState().goalListByAgentId).toEqual({});
    expect(useGoalStore.getState().goalListInitializedAgentIds).toEqual([]);
    expect(useGoalStore.getState().homeGoalsByScope).toEqual({});
    expect(useGoalStore.getState().homeGoalsInitializedScopes).toEqual([]);
  });

  it('does not carry account A verification data into account B', () => {
    stores.reset();

    expect(useVerifyStore.getState().acceptanceBundleMap).toEqual({});
    expect(useVerifyStore.getState().criterionEdits).toEqual({});
    expect(useVerifyStore.getState().instructionEdits).toEqual({});
  });

  it('cancels account A pending group profile save', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    useGroupProfileStore.setState({
      activeTabId: 'account-a-agent',
      editor: {
        getDocument: vi.fn((format: string) =>
          format === 'markdown' ? 'Account A draft' : { root: {} },
        ),
      } as never,
    });

    useGroupProfileStore.getState().handleContentChange(save);
    stores.reset();
    await vi.runAllTimersAsync();

    expect(save).not.toHaveBeenCalled();
  });

  it('cancels account A pending verification save', async () => {
    vi.useFakeTimers();
    const updateCriterion = vi
      .spyOn(verifyService, 'updateCriterion')
      .mockResolvedValue(undefined as never);

    useVerifyStore
      .getState()
      .updateCriterion('account-a-criterion', { title: 'Account A pending edit' });
    stores.reset();
    await vi.runAllTimersAsync();

    expect(updateCriterion).not.toHaveBeenCalled();
  });
});
