import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearResourceDeletionCache } from './resourceDeletionCache';

const mocks = vi.hoisted(() => {
  const store = () => ({
    state: {} as any,
    setState: vi.fn(function (this: any, update: any) {
      this.state = { ...this.state, ...update(this.state) };
    }),
  });
  return {
    document: store(),
    goal: store(),
    task: store(),
    project: store(),
    chat: store(),
    file: store(),
    mutate: vi.fn(),
    evict: vi.fn(),
  };
});
vi.mock('@/store/document', () => ({ useDocumentStore: mocks.document }));
vi.mock('@/store/goal', () => ({ useGoalStore: mocks.goal }));
vi.mock('@/store/task', () => ({ useTaskStore: mocks.task }));
vi.mock('@/store/project/store', () => ({ useProjectStore: mocks.project }));
vi.mock('@/store/chat', () => ({ useChatStore: mocks.chat }));
vi.mock('@/store/file/store', () => ({ useFileStore: mocks.file }));
vi.mock('@/store/chat/utils/evictMessageCache', () => ({ evictMessageCache: mocks.evict }));
vi.mock('@/libs/swr', () => ({ mutate: mocks.mutate }));

const deletion = {
  deletedIds: { goals: ['g1'], tasks: ['t1'], projects: ['p1'], topics: ['topic1'], files: ['f1'] },
  affectedGroupIds: ['group1'],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.goal.state = {
    goalGraphById: { g1: {}, keep: {} },
    goalMetricSeriesById: { g1: [], keep: [] },
    goalListByAgentId: { a: [{ goal: { id: 'g1' } }, { goal: { id: 'keep' } }] },
    homeGoalsByScope: {},
  };
  mocks.task.state = {
    tasks: [
      { id: 't1', identifier: 'T-1' },
      { id: 'keep', identifier: 'T-2' },
    ],
    tasksTotal: 2,
    taskGroups: [{ tasks: [{ id: 't1' }, { id: 'keep' }] }],
    taskDetailMap: { 'T-1': { id: 't1' }, 'T-2': { id: 'keep', instruction: 'unsaved' } },
    taskSaveStatusMap: { 'T-1': 'saved', 'T-2': 'saving' },
    taskInstructionRevisionMap: {},
    activeTaskId: 'T-2',
  };
  mocks.project.state = {
    projectLists: { scope: [{ id: 'p1' }, { id: 'keep' }] },
    projectDetails: { scope: { p1: { project: { id: 'p1' } }, keep: { project: { id: 'keep' } } } },
  };
  mocks.chat.state = {
    topicDataMap: { a: { items: [{ id: 'topic1' }, { id: 'keep' }], total: 2 } },
    agentTopicsViewMap: {},
    topicDetailMap: { topic1: {}, keep: {} },
    searchTopics: [],
    activeTopicId: 'keep',
    inputMessage: 'draft',
  };
  mocks.file.state = {
    fileList: [{ id: 'f1' }, { id: 'keep' }],
    resourceList: [{ id: 'f1' }, { id: 'keep' }],
    resourceMap: new Map([
      ['f1', {}],
      ['keep', {}],
    ]),
    total: 2,
    dockUploadFileList: ['upload draft'],
  };
});
describe('cascade deletion caches', () => {
  it('evicts only deleted identities and affected timelines, preserving unrelated drafts', async () => {
    await clearResourceDeletionCache(deletion);
    expect(mocks.goal.state.goalListByAgentId.a).toEqual([{ goal: { id: 'keep' } }]);
    expect(mocks.task.state.taskDetailMap).toEqual({
      'T-2': { id: 'keep', instruction: 'unsaved' },
    });
    expect(mocks.task.state.taskSaveStatusMap).toEqual({ 'T-2': 'saving' });
    expect(mocks.task.state.tasksTotal).toBe(1);
    expect(mocks.task.state.taskGroups[0].tasks).toEqual([{ id: 'keep' }]);
    expect(mocks.project.state.projectLists.scope).toEqual([{ id: 'keep' }]);
    expect(mocks.chat.state.topicDataMap.a.items).toEqual([{ id: 'keep' }]);
    expect(mocks.chat.state.inputMessage).toBe('draft');
    expect(mocks.file.state.resourceMap.has('f1')).toBe(false);
    expect(mocks.file.state.dockUploadFileList).toEqual(['upload draft']);
    const predicate = mocks.evict.mock.calls[0][0];
    expect(predicate({ topicId: 'topic1' })).toBe(true);
    expect(predicate({ groupId: 'group1' })).toBe(true);
    expect(predicate({ topicId: 'keep', groupId: 'other' })).toBe(false);
    expect(mocks.mutate).toHaveBeenCalled();
  });
  it('does not restore deleted data when refreshing the server list fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.mutate.mockRejectedValueOnce(new Error('offline'));
    await expect(clearResourceDeletionCache(deletion)).resolves.toBeUndefined();
    expect(mocks.task.state.taskDetailMap['T-1']).toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
  it('supports legacy responses without deletion metadata', async () => {
    await clearResourceDeletionCache(undefined);
    expect(mocks.evict).not.toHaveBeenCalled();
    expect(mocks.goal.setState).not.toHaveBeenCalled();
  });
});

it('clears document and work caches even with no physical files, preserving shared editor drafts', async () => {
  mocks.document.state = {
    documents: { doc1: { content: 'deleted' }, shared: { content: 'unsaved shared draft' } },
    activeDocumentId: 'shared',
    editorState: 'current editor',
    lastActiveTopicDocumentIdByTopicId: { topic1: 'doc1', other: 'shared' },
  };
  mocks.file.state.documents = [{ id: 'doc1' }, { id: 'shared' }];
  mocks.file.state.documentsTotal = 2;
  mocks.file.state.localDocumentMap = new Map([
    ['doc1', {}],
    ['shared', {}],
  ]);
  mocks.file.state.resourceList = [{ id: 'doc1' }, { id: 'shared' }];
  mocks.file.state.resourceMap = new Map([
    ['doc1', {}],
    ['shared', {}],
  ]);
  await clearResourceDeletionCache({
    ...deletion,
    deletedIds: { ...deletion.deletedIds, files: [], documents: ['doc1'], works: ['work1'] },
  });
  expect(mocks.file.state.documents).toEqual([{ id: 'shared' }]);
  expect(mocks.file.state.resourceMap.has('doc1')).toBe(false);
  expect(mocks.document.state.documents).toEqual({ shared: { content: 'unsaved shared draft' } });
  expect(mocks.document.state.editorState).toBe('current editor');
  const [evict] = mocks.mutate.mock.calls[0];
  expect(evict(['document:editor', 'doc1'])).toBe(true);
  expect(evict(['document:editor', 'shared'])).toBe(false);
  expect(evict(['work:versions', 'work1'])).toBe(true);
  const [refresh] = mocks.mutate.mock.calls[1];
  expect(refresh(['resource:list', {}])).toBe(true);
  expect(refresh(['work:workspace', null])).toBe(true);
  expect(refresh(['page:list'])).toBe(true);
});

it('invalidates resource collections for legacy root deletions with no file IDs', async () => {
  await clearResourceDeletionCache({
    ...deletion,
    deletedIds: { ...deletion.deletedIds, files: [] },
  });
  const [refresh] = mocks.mutate.mock.calls[1];
  expect(refresh(['resource:list', {}])).toBe(true);
  expect(refresh(['work:workspace', null])).toBe(true);
  expect(refresh(['page:list'])).toBe(true);
});
