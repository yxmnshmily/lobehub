import { mutate } from '@/libs/swr';
import { evictMessageCache } from '@/store/chat/utils/evictMessageCache';

interface DeletionResult {
  affectedGroupIds: string[];
  deletedIds: {
    documents?: string[];
    works?: string[];
    files: string[];
    goals: string[];
    projects: string[];
    tasks: string[];
    topics: string[];
  };
}

const omitIds = <T>(map: Record<string, T>, ids: Set<string>): Record<string, T> =>
  Object.fromEntries(Object.entries(map).filter(([id]) => !ids.has(id)));

/** Apply authoritative deletion identities without resetting editors, uploads or workspace state. */
export const clearResourceDeletionCache = async (deletion?: DeletionResult): Promise<void> => {
  if (!deletion) return;
  const goals = new Set(deletion.deletedIds.goals);
  const tasks = new Set(deletion.deletedIds.tasks);
  const projects = new Set(deletion.deletedIds.projects);
  const topics = new Set(deletion.deletedIds.topics);
  const files = new Set(deletion.deletedIds.files);
  const documents = new Set(deletion.deletedIds.documents ?? []);
  const works = new Set(deletion.deletedIds.works ?? []);
  const resourceIds = new Set([...files, ...documents]);
  const rootsChanged = goals.size + tasks.size + projects.size + topics.size > 0;
  const groups = new Set(deletion.affectedGroupIds);
  const taskIdentifiers = new Set(tasks);
  const operations: Promise<unknown>[] = [];
  if (topics.size || groups.size)
    operations.push(
      evictMessageCache(
        (context) =>
          !!(
            (context.topicId && topics.has(context.topicId)) ||
            (context.groupId && groups.has(context.groupId))
          ),
      ),
    );
  if (goals.size)
    operations.push(
      import('@/store/goal').then(({ useGoalStore }) => {
        useGoalStore.setState((state) => ({
          goalGraphById: omitIds(state.goalGraphById, goals),
          goalMetricSeriesById: omitIds(state.goalMetricSeriesById, goals),
          goalListByAgentId: Object.fromEntries(
            Object.entries(state.goalListByAgentId).map(([scope, list]) => [
              scope,
              list.filter((item) => !goals.has(item.goal.id)),
            ]),
          ),
          homeGoalsByScope: Object.fromEntries(
            Object.entries(state.homeGoalsByScope).map(([scope, list]) => [
              scope,
              list.filter((item) => !goals.has(item.goal.id)),
            ]),
          ),
        }));
      }),
    );
  if (tasks.size)
    operations.push(
      import('@/store/task').then(({ useTaskStore }) => {
        useTaskStore.setState((state) => {
          const identifiers = new Set([
            ...tasks,
            ...Object.entries(state.taskDetailMap)
              .filter(([, detail]) => detail.id && tasks.has(detail.id))
              .map(([id]) => id),
            ...state.tasks.filter((task) => tasks.has(task.id)).map((task) => task.identifier),
          ]);
          for (const id of identifiers) taskIdentifiers.add(id);
          const retained = state.tasks.filter((task) => !tasks.has(task.id));
          return {
            tasks: retained,
            tasksTotal: Math.max(0, state.tasksTotal - (state.tasks.length - retained.length)),
            taskGroups: state.taskGroups.map((group) => ({
              ...group,
              tasks: group.tasks.filter((task) => !tasks.has(task.id)),
            })),
            taskDetailMap: omitIds(state.taskDetailMap, identifiers),
            taskSaveStatusMap: omitIds(state.taskSaveStatusMap, identifiers),
            taskInstructionRevisionMap: omitIds(state.taskInstructionRevisionMap, identifiers),
            activeTaskId:
              state.activeTaskId && identifiers.has(state.activeTaskId)
                ? undefined
                : state.activeTaskId,
          };
        });
      }),
    );
  if (projects.size)
    operations.push(
      import('@/store/project/store').then(({ useProjectStore }) => {
        useProjectStore.setState((state) => ({
          projectLists: Object.fromEntries(
            Object.entries(state.projectLists).map(([scope, list]) => [
              scope,
              list.filter((item) => !projects.has(item.id)),
            ]),
          ),
          projectDetails: Object.fromEntries(
            Object.entries(state.projectDetails).map(([scope, details]) => [
              scope,
              omitIds(details, projects),
            ]),
          ),
        }));
      }),
    );
  if (topics.size)
    operations.push(
      import('@/store/chat').then(({ useChatStore }) => {
        useChatStore.setState((state) => {
          const prune = (map: typeof state.topicDataMap) =>
            Object.fromEntries(
              Object.entries(map).map(([scope, data]) => {
                const items = data.items.filter((item) => !topics.has(item.id));
                return [
                  scope,
                  {
                    ...data,
                    items,
                    total: Math.max(0, data.total - (data.items.length - items.length)),
                  },
                ];
              }),
            );
          return {
            topicDataMap: prune(state.topicDataMap),
            agentTopicsViewMap: prune(state.agentTopicsViewMap),
            topicDetailMap: omitIds(state.topicDetailMap, topics),
            searchTopics: state.searchTopics.filter((item) => !topics.has(item.id)),
            activeTopicId:
              state.activeTopicId && topics.has(state.activeTopicId)
                ? undefined
                : state.activeTopicId,
          };
        });
      }),
    );
  if (documents.size)
    operations.push(
      import('@/store/document').then(({ useDocumentStore }) => {
        useDocumentStore.setState((state) => ({
          documents: omitIds(state.documents, documents),
          activeDocumentId:
            state.activeDocumentId && documents.has(state.activeDocumentId)
              ? undefined
              : state.activeDocumentId,
          editorState:
            state.activeDocumentId && documents.has(state.activeDocumentId)
              ? undefined
              : state.editorState,
          lastActiveTopicDocumentIdByTopicId: Object.fromEntries(
            Object.entries(state.lastActiveTopicDocumentIdByTopicId).filter(
              ([, id]) => !documents.has(id),
            ),
          ),
        }));
      }),
    );
  if (resourceIds.size)
    operations.push(
      import('@/store/file/store').then(({ useFileStore }) => {
        useFileStore.setState((state) => {
          const resourceList = state.resourceList.filter((item) => !resourceIds.has(item.id));
          return {
            ...(documents.size
              ? {
                  documents: state.documents.filter((item) => !documents.has(item.id)),
                  documentsTotal: Math.max(
                    0,
                    state.documentsTotal -
                      state.documents.filter((item) => documents.has(item.id)).length,
                  ),
                  localDocumentMap: new Map(
                    [...state.localDocumentMap].filter(([id]) => !documents.has(id)),
                  ),
                }
              : {}),
            fileList: state.fileList.filter((item) => !files.has(item.id)),
            fileDetail:
              state.fileDetail && files.has(state.fileDetail.id) ? undefined : state.fileDetail,
            resourceList,
            resourceMap: new Map([...state.resourceMap].filter(([id]) => !resourceIds.has(id))),
            total: Math.max(0, state.total - (state.resourceList.length - resourceList.length)),
          };
        });
      }),
    );
  // Never turn a successful server deletion into a store rollback of a deleted entity.
  const results = await Promise.allSettled(operations);
  for (const result of results)
    if (result.status === 'rejected')
      console.error('[resourceDeletion] Cache eviction failed', result.reason);
  try {
    const deletedDetail = (key: unknown) => {
      if (!Array.isArray(key)) return false;
      return (
        (['document:editor', 'page:detail', 'page:meta'].includes(key[0]) &&
          documents.has(key[1])) ||
        (['agent:documentReader', 'agent:documentEditor', 'agent:documentChatTopic'].includes(
          key[0],
        ) &&
          documents.has(key[2])) ||
        (key[0] === 'work:versions' && works.has(key[1])) ||
        (key[0] === 'task:detail' && taskIdentifiers.has(key[1])) ||
        ((key[0] === 'goal:graph' || key[0] === 'goal:metricSeries') && goals.has(key[1])) ||
        (key[0] === 'project/detail' && projects.has(key[2])) ||
        (key[0] === 'topic:detail' && topics.has(key[1]))
      );
    };
    await mutate(deletedDetail, undefined, { revalidate: false });
    await mutate(
      (key) => {
        const root = Array.isArray(key) ? key[0] : key;
        return (
          typeof root === 'string' &&
          ((goals.size > 0 && (root === 'task:homeGoals' || root === 'task:sidebarGroups')) ||
            (tasks.size > 0 && root.startsWith('task:') && root !== 'task:detail') ||
            (projects.size > 0 && root === 'project/list') ||
            (topics.size > 0 && (root === 'topic:list' || root === 'topic:agentView')) ||
            (files.size > 0 && root === 'file:knowledgeItems') ||
            ((resourceIds.size > 0 || rootsChanged) && root.startsWith('resource:')) ||
            ((works.size > 0 || rootsChanged) &&
              (root === 'work:workspace' || root === 'work:conversation')) ||
            ((documents.size > 0 || rootsChanged) &&
              [
                'page:list',
                'notebook:documents',
                'agent:documents',
                'agent:documentsList',
              ].includes(root)))
        );
      },
      undefined,
      { revalidate: true },
    );
  } catch (error) {
    console.error('[resourceDeletion] Cache revalidation failed', error);
  }
};
