import { beforeEach, describe, expect, it } from 'vitest';

import { useTopicsViewStore } from './store';

describe('AgentTopicManager store', () => {
  beforeEach(() => {
    useTopicsViewStore.getState().reset();
  });

  it('defaults to the table list and still allows switching to cards', () => {
    expect(useTopicsViewStore.getState().viewMode).toBe('list');
    expect(useTopicsViewStore.getState().triggers).toEqual(['chat']);
    useTopicsViewStore.getState().setViewMode('card');
    expect(useTopicsViewStore.getState().viewMode).toBe('card');
    useTopicsViewStore.getState().reset();
    expect(useTopicsViewStore.getState().viewMode).toBe('list');
  });

  it('switches the source to bot when selecting a channel', () => {
    useTopicsViewStore.getState().toggleBotChannel('discord');

    expect(useTopicsViewStore.getState()).toMatchObject({
      botChannels: ['discord'],
      triggers: ['bot'],
    });
  });

  it('clears selected channels when removing the bot source', () => {
    useTopicsViewStore.setState({ botChannels: ['discord'], triggers: ['bot'] });

    useTopicsViewStore.getState().toggleTrigger('bot');

    expect(useTopicsViewStore.getState()).toMatchObject({
      botChannels: [],
      triggers: [],
    });
  });
});
