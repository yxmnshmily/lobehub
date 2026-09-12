export type ViewMode = 'card' | 'list';

/** Mutations supplied by a topic page's owning scope. */
export interface TopicManagementActions {
  favoriteTopic: (id: string, favorite: boolean) => Promise<unknown>;
  removeTopic: (id: string, removeFiles?: boolean) => Promise<unknown>;
  updateTopicStatus: (input: {
    topicId: string;
    status: 'active' | 'completed';
  }) => Promise<unknown>;
}

export type StatusFilter = 'all' | 'active' | 'running' | 'completed' | 'archived';

export type TriggerFilter = 'chat' | 'api' | 'task' | 'eval' | 'bot';

export type TimeRangeFilter = 'all' | 'today' | 'week' | 'month';

export type SortBy = 'updatedAt' | 'createdAt' | 'title';

export type GroupBy = 'byProject' | 'byTime' | 'none';

/**
 * A bot source platform, identified by `topic.metadata.bot.platform`
 * (e.g. `discord` / `telegram`). One value selects topics that arrived
 * through any channel of that platform's bot.
 */
export type BotChannelFilter = string;

/** One selectable bot source platform inside the flattened channel menu. */
export interface BotChannelOption {
  /** Platform id, e.g. `discord` — the filter value. */
  key: string;
  /** Display label, e.g. `Discord` / `Telegram`. */
  label: string;
}
