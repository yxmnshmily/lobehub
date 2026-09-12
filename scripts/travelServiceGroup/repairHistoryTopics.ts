/** Explicitly scoped, rollback-by-default repair; never deletes a transcript. */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import { recomputeTopicUsage } from '../../packages/database/src/models/topicUsage';
import type { Transaction } from '../../packages/database/src/type';
import { planHistoryTopics } from './historyTopicPlan';

const groupId = process.argv.find((arg) => arg.startsWith('--group='))?.slice(8);
const apply = process.argv.includes('--apply');
const reportPath = process.argv.find((arg) => arg.startsWith('--report='))?.slice(9);
if (!groupId || !/^[\w-]{1,100}$/.test(groupId) || (apply && !reportPath))
  throw new Error(
    'Usage: bun scripts/travelServiceGroup/repairHistoryTopics.ts --group=ID [--apply --report=/absolute/new-manifest.json]',
  );

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await client.query("SET LOCAL lock_timeout = '3s'");
  await client.query("SET LOCAL statement_timeout = '15s'");
  const group = (
    await client.query(
      'SELECT id,user_id FROM chat_groups WHERE id=$1 AND workspace_id IS NULL FOR UPDATE',
      [groupId],
    )
  ).rows[0];
  if (!group) throw new Error('Personal group not found');
  const originals = (
    await client.query(
      'SELECT * FROM topics WHERE group_id=$1 AND user_id=$2 AND workspace_id IS NULL AND deleted_at IS NULL ORDER BY created_at,id FOR UPDATE',
      [groupId, group.user_id],
    )
  ).rows;
  const sourceIds = originals.map((t) => t.id);
  const originalMessages = (
    await client.query(
      'SELECT * FROM messages WHERE topic_id=ANY($1) ORDER BY created_at,id FOR UPDATE',
      [sourceIds],
    )
  ).rows;
  const before = {
    messages: originalMessages.length,
    cost: originals.reduce((sum, t) => sum + Number(t.total_cost ?? 0), 0),
    tokens: originals.reduce((sum, t) => sum + Number(t.total_tokens ?? 0), 0),
  };
  const manifest: any = {
    version: 1,
    groupId,
    createdAt: new Date(),
    before,
    topics: [],
    messages: [],
    threads: [],
    operations: [],
    createdTopics: [],
  };
  const foreignKeys = (
    await client.query(`SELECT tc.table_name,kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu USING(constraint_name,constraint_schema)
    JOIN information_schema.constraint_column_usage ccu USING(constraint_name,constraint_schema)
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='topics'`)
  ).rows;
  const summary: { title: string; messages: number }[] = [];
  for (const topic of originals) {
    const rows = originalMessages.filter((m) => m.topic_id === topic.id);
    const threads = (
      await client.query('SELECT * FROM threads WHERE topic_id=$1 FOR UPDATE', [topic.id])
    ).rows;
    const plan = planHistoryTopics(topic.id, groupId, rows, threads);
    if (!plan.boundaries.length) continue;
    if (topic.history_summary)
      throw new Error(`Topic has a compressed history summary: ${topic.id}`);
    // Unknown associations must be reviewed, never silently left on an unrelated archive.
    for (const fk of foreignKeys) {
      if (['messages', 'threads', 'agent_operations'].includes(fk.table_name)) continue;
      if (!/^[a-z_]+$/.test(fk.table_name) || !/^[a-z_]+$/.test(fk.column_name))
        throw new Error('Unexpected schema identifier');
      const n = (
        await client.query(
          `SELECT count(*)::int AS n FROM "${fk.table_name}" WHERE "${fk.column_name}"=$1`,
          [topic.id],
        )
      ).rows[0].n;
      if (n) throw new Error(`Review linked ${fk.table_name} before splitting ${topic.id}`);
    }
    const operations = (
      await client.query('SELECT * FROM agent_operations WHERE topic_id=$1 FOR UPDATE', [topic.id])
    ).rows;
    if (operations.some((op) => !['done', 'failed', 'aborted', 'cancelled'].includes(op.status)))
      throw new Error(`Topic still has a live operation: ${topic.id}`);
    const topicFor = (messageId: string) => {
      if (!plan.messageAnchors.has(messageId))
        throw new Error(`Unresolved message anchor: ${messageId}`);
      const anchor = plan.messageAnchors.get(messageId);
      return anchor
        ? `tpc_${createHash('sha256').update(`${topic.id}:${anchor}`).digest('hex').slice(0, 20)}`
        : topic.id;
    };
    manifest.topics.push(topic);
    for (const boundary of plan.boundaries) {
      const id = topicFor(boundary.id);
      const title = (boundary.content ?? '').trim().replaceAll(/\s+/g, ' ').slice(0, 100);
      const metadata = {
        historyTopicRepair: { sourceTopicId: topic.id, anchorMessageId: boundary.id, version: 1 },
      };
      await client.query(
        `INSERT INTO topics(id,user_id,group_id,agent_id,project_id,title,status,trigger,model,provider,created_at,updated_at,metadata)
        SELECT $1,user_id,group_id,agent_id,project_id,$2,status,trigger,model,provider,$3,$3,$4::jsonb FROM topics WHERE id=$5`,
        [id, title, boundary.created_at, JSON.stringify(metadata), topic.id],
      );
      manifest.createdTopics.push(id);
      summary.push({ title, messages: rows.filter((m) => topicFor(m.id) === id).length });
    }
    for (const row of rows) {
      const destination = topicFor(row.id);
      if (destination === topic.id) continue;
      manifest.messages.push({ id: row.id, topic_id: topic.id, destination });
      await client.query('UPDATE messages SET topic_id=$1 WHERE id=$2 AND topic_id=$3', [
        destination,
        row.id,
        topic.id,
      ]);
    }
    for (const thread of threads) {
      const destination = topicFor(thread.source_message_id);
      const threadMessages = rows.filter((m) => m.thread_id === thread.id);
      if (threadMessages.some((m) => topicFor(m.id) !== destination))
        throw new Error('Thread split across archives');
      if (destination === topic.id) continue;
      manifest.threads.push({ id: thread.id, topic_id: topic.id, destination });
      await client.query('UPDATE threads SET topic_id=$1 WHERE id=$2', [destination, thread.id]);
    }
    const operationDestinations = new Map<string, string>();
    for (const op of operations) {
      const anchors = rows.filter((m) => m.metadata?.operationId === op.id).map((m) => m.id);
      if (op.app_context?.sourceMessageId) anchors.push(op.app_context.sourceMessageId);
      const destinations = new Set(anchors.map(topicFor));
      if (destinations.size !== 1) throw new Error(`Unresolved operation relation: ${op.id}`);
      operationDestinations.set(op.id, [...destinations][0]);
    }
    for (const op of operations) {
      const destination = operationDestinations.get(op.id)!;
      if (
        op.parent_operation_id &&
        operationDestinations.get(op.parent_operation_id) !== destination
      )
        throw new Error('Operation tree crosses archives');
      if (destination === topic.id) continue;
      manifest.operations.push({
        id: op.id,
        topic_id: topic.id,
        app_context: op.app_context,
        destination,
      });
      const context = op.app_context?.topicId
        ? { ...op.app_context, topicId: destination }
        : op.app_context;
      await client.query(
        'UPDATE agent_operations SET topic_id=$1,app_context=$2::jsonb WHERE id=$3',
        [destination, JSON.stringify(context), op.id],
      );
    }
    for (const id of [topic.id, ...plan.boundaries.map((b) => topicFor(b.id))]) {
      await recomputeTopicUsage(drizzle(client) as unknown as Transaction, group.user_id, id);
      await client.query(
        'UPDATE topics SET updated_at=COALESCE((SELECT max(updated_at) FROM messages WHERE topic_id=$1),created_at) WHERE id=$1',
        [id],
      );
    }
  }
  const allIds = [...sourceIds, ...manifest.createdTopics];
  // IDs, contents, authors, parents, attachments and private group/thread scope stay unchanged.
  const afterMessages = (
    await client.query('SELECT * FROM messages WHERE topic_id=ANY($1) ORDER BY created_at,id', [
      allIds,
    ])
  ).rows;
  const withoutTopic = (rows: any[]) => rows.map(({ topic_id: _ignored, ...row }) => row);
  if (
    JSON.stringify(withoutTopic(originalMessages)) !== JSON.stringify(withoutTopic(afterMessages))
  )
    throw new Error('Transcript invariant failed');
  const totals = (
    await client.query(
      'SELECT sum(total_cost) AS cost,sum(total_tokens) AS tokens FROM topics WHERE id=ANY($1)',
      [allIds],
    )
  ).rows[0];
  if (
    Math.abs(Number(totals.cost ?? 0) - before.cost) > 0.000001 ||
    Number(totals.tokens ?? 0) !== before.tokens
  )
    throw new Error('Usage totals changed; rolling back');
  if (apply && manifest.createdTopics.length)
    writeFileSync(resolve(reportPath!), JSON.stringify(manifest, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(
    JSON.stringify(
      {
        applied: apply,
        groupId,
        topicsBefore: sourceIds.length,
        topicsAfter: allIds.length,
        messagesUnchanged: before.messages,
        usageUnchanged: true,
        newTopics: summary,
        report: apply ? reportPath : undefined,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
