import { describe, expect, it } from 'vitest';

import { createWebsiteAiPreviousTurnStore } from './previousTurn';

class FakePreviousTurnRedis {
  now = 1_000;
  readonly values = new Map<string, { expiresAt: number; value: string }>();

  private expire(key: string) {
    const entry = this.values.get(key);
    if (entry && entry.expiresAt <= this.now) this.values.delete(key);
  }

  async eval(
    _script: string,
    _keys: number,
    key: string,
    owner: string,
    status: string,
    ttl: string,
  ) {
    this.expire(key);
    const entry = this.values.get(key);
    if (!entry) return 0;
    const record = JSON.parse(entry.value) as Record<string, unknown>;
    if (record.owner !== owner) return 0;
    if (status !== 'succeeded') {
      this.values.delete(key);
      return 1;
    }
    record.taskStatus = 'succeeded';
    this.values.set(key, {
      expiresAt: this.now + Number(ttl) * 1000,
      value: JSON.stringify(record),
    });
    return 1;
  }

  async get(key: string) {
    this.expire(key);
    return this.values.get(key)?.value ?? null;
  }

  async set(key: string, value: string, _expiry: 'EX', ttl: number) {
    this.values.set(key, { expiresAt: this.now + ttl * 1000, value });
    return 'OK';
  }
}

const scope = {
  groupId: 'private-group',
  topicId: 'topic-a',
  userId: 'private-user',
};

describe('website AI previous-turn store', () => {
  it('exposes only confirmed intents and succeeded status after owned settlement', async () => {
    const redis = new FakePreviousTurnRedis();
    const store = createWebsiteAiPreviousTurnStore({
      getRedis: () => redis as never,
      ownerToken: () => 'owner-a',
    });
    const handle = await store.begin(scope, ['document', 'copy']);

    await expect(store.read(scope)).resolves.toBeUndefined();
    await expect(store.settle(handle!, 'succeeded')).resolves.toBe(true);
    await expect(store.read(scope)).resolves.toEqual({
      confirmedIntents: ['document', 'copy'],
      taskStatus: 'succeeded',
    });

    const persisted = JSON.stringify([...redis.values]);
    expect(persisted).not.toMatch(/private-user|private-group|topic-a/);
    expect(persisted).not.toMatch(/history|message|model|provider|balance/);
  });

  it.each([
    ['another user', { ...scope, userId: 'other-user' }],
    ['another workspace', { ...scope, workspaceId: 'workspace-b' }],
    ['another group', { ...scope, groupId: 'other-group' }],
    ['another topic', { ...scope, topicId: 'topic-b' }],
  ])('does not cross the %s scope', async (_label, otherScope) => {
    const redis = new FakePreviousTurnRedis();
    const store = createWebsiteAiPreviousTurnStore({
      getRedis: () => redis as never,
      ownerToken: () => 'owner-a',
    });
    const handle = await store.begin(scope, ['document']);
    await store.settle(handle!, 'succeeded');

    await expect(store.read(otherScope)).resolves.toBeUndefined();
  });

  it('expires context and never revives it from the local fallback', async () => {
    let now = 1_000;
    const store = createWebsiteAiPreviousTurnStore({
      getRedis: () => null,
      now: () => now,
      ownerToken: () => 'owner-a',
      ttlMs: 1_000,
    });
    const handle = await store.begin(scope, ['copy']);
    await store.settle(handle!, 'succeeded');

    now = 2_001;
    await expect(store.read(scope)).resolves.toBeUndefined();
    await expect(store.settle(handle!, 'succeeded')).resolves.toBe(false);
  });

  it('records an informational turn as owned but never exposes an empty intent', async () => {
    const redis = new FakePreviousTurnRedis();
    const store = createWebsiteAiPreviousTurnStore({
      getRedis: () => redis as never,
      ownerToken: () => 'informational-owner',
    });

    const handle = await store.begin(scope, []);

    expect(handle).toBeDefined();
    await expect(store.read(scope)).resolves.toBeUndefined();
    await expect(store.settle(handle!, 'succeeded')).resolves.toBe(true);
    await expect(store.read(scope)).resolves.toBeUndefined();
  });

  it.each([
    ['running status', { taskStatus: 'running' }],
    ['failed status', { taskStatus: 'failed' }],
    ['unknown status', { taskStatus: 'private-status' }],
    ['unknown intent', { confirmedIntents: ['document', 'private-intent'] }],
    ['duplicate intent', { confirmedIntents: ['document', 'document'] }],
    ['extra history field', { historyText: 'private body' }],
    ['extra provider field', { provider: 'private-provider' }],
    ['extra account field', { userId: 'private-user' }],
  ])('rejects a stored record with %s', async (_label, patch) => {
    const redis = new FakePreviousTurnRedis();
    const store = createWebsiteAiPreviousTurnStore({
      getRedis: () => redis as never,
      ownerToken: () => 'owner-a',
    });
    const handle = await store.begin(scope, ['document']);
    const entry = redis.values.get(handle!.key)!;
    const record = JSON.parse(entry.value) as Record<string, unknown>;
    redis.values.set(handle!.key, { ...entry, value: JSON.stringify({ ...record, ...patch }) });

    await expect(store.read(scope)).resolves.toBeUndefined();
  });

  it('prevents an old owner from settling or deleting a replacement turn', async () => {
    const redis = new FakePreviousTurnRedis();
    const owners = ['owner-old', 'owner-new'];
    const store = createWebsiteAiPreviousTurnStore({
      getRedis: () => redis as never,
      ownerToken: () => owners.shift()!,
    });
    const old = await store.begin(scope, ['copy']);
    const replacement = await store.begin(scope, ['image']);

    await expect(store.settle(old!, 'failed')).resolves.toBe(false);
    await expect(store.settle(old!, 'succeeded')).resolves.toBe(false);
    await expect(store.settle(replacement!, 'succeeded')).resolves.toBe(true);
    await expect(store.read(scope)).resolves.toEqual({
      confirmedIntents: ['image'],
      taskStatus: 'succeeded',
    });
  });
});
