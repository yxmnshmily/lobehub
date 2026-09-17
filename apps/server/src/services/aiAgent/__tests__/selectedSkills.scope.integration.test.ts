// @vitest-environment node
import { users, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { inArray } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { AgentSkillModel } from '@/database/models/agentSkill';

it('resolves same-name skill bodies only inside the selected caller/workspace scope', async () => {
  const db = await getTestDB();
  const suffix = crypto.randomUUID();
  const owner = `skill-owner-${suffix}`;
  const other = `skill-other-${suffix}`;
  const workspace = `skill-workspace-${suffix}`;
  await db.insert(users).values([{ id: owner }, { id: other }]);
  try {
    await db
      .insert(workspaces)
      .values({ id: workspace, slug: workspace, name: 'Skills', primaryOwnerId: owner });
    const personal = new AgentSkillModel(db, owner);
    const foreign = new AgentSkillModel(db, other);
    const scoped = new AgentSkillModel(db, owner, workspace);
    const input = {
      identifier: 'same-skill',
      name: 'Same skill',
      description: 'Scope test',
      source: 'user' as const,
    };
    const ownRow = await personal.create({ ...input, content: 'Personal body' });
    const foreignRow = await foreign.create({ ...input, content: 'Foreign body' });
    const workspaceRow = await scoped.create({ ...input, content: 'Workspace body' });
    const ids = [ownRow.id, foreignRow.id, workspaceRow.id];
    expect((await personal.findAll()).data.map((skill) => skill.id)).toEqual([ownRow.id]);
    expect((await personal.findByIds(ids)).map((skill) => skill.content)).toEqual([
      'Personal body',
    ]);
    expect((await scoped.findAll()).data.map((skill) => skill.id)).toEqual([workspaceRow.id]);
    expect((await scoped.findByIds(ids)).map((skill) => skill.content)).toEqual(['Workspace body']);
    expect((await foreign.findByIds(ids)).map((skill) => skill.content)).toEqual(['Foreign body']);
  } finally {
    await db.delete(users).where(inArray(users.id, [owner, other]));
  }
});
