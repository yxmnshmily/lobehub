// @vitest-environment node
import {
  agents,
  agentSkills,
  globalFiles,
  roles,
  userRoles,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { initDefaultTravelServiceGroup } from './travelServiceGroup';
import {
  getSuperGroupTemplate,
  importSuperGroupTemplateMember,
} from './travelServiceGroupTemplate';

const db = await getTestDB();
const admin = 'resource-publisher';
const customer = 'resource-consumer';
const identifier = 'resource-test-skill';
const resources = { 'references/guide.md': { fileHash: 'reference-v1', size: 8 } };

beforeEach(async () => {
  await db.delete(agentSkills);
  await db.delete(globalFiles);
  await db.delete(users);
  await db.insert(users).values([admin, customer].map((id) => ({ id, emailVerified: true })));
  await db
    .insert(roles)
    .values({ name: 'super_admin', displayName: 'Admin', isActive: true })
    .onConflictDoNothing();
  const role = await db.query.roles.findFirst({ where: eq(roles.name, 'super_admin') });
  await db.insert(userRoles).values({ roleId: role!.id, userId: admin });
  await initDefaultTravelServiceGroup(db, admin);
  await initDefaultTravelServiceGroup(db, customer);
  await db.insert(globalFiles).values(
    ['archive-v1', 'reference-v1', 'reference-v2'].map((hashId) => ({
      hashId,
      creator: admin,
      size: 8,
      fileType: 'text/plain',
      url: `skills/${hashId}`,
    })),
  );
});

async function sourceMember() {
  await db.insert(agentSkills).values({
    userId: admin,
    identifier,
    name: 'Resource skill',
    description: 'guide',
    source: 'market',
    content: 'Read references/guide.md',
    resources,
    zipFileHash: 'archive-v1',
  });
  const [source] = await db
    .insert(agents)
    .values({
      userId: admin,
      title: 'Writer',
      model: 'test-model',
      provider: 'test-provider',
      plugins: [identifier],
    })
    .returning();
  return source;
}

describe('explicit resource skill publication', () => {
  it('requires opt-in, then retains the archive and resources in existing and future group copies', async () => {
    const source = await sourceMember();
    await expect(
      importSuperGroupTemplateMember(db, admin, { agentId: source.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const { member } = await importSuperGroupTemplateMember(db, admin, {
      agentId: source.id,
      publishResourceSkills: [identifier],
    });
    expect(member.pendingReason).toBeUndefined();
    await db.insert(users).values({ id: 'future-resource-user', emailVerified: true });
    await initDefaultTravelServiceGroup(db, 'future-resource-user');
    for (const userId of [admin, customer, 'future-resource-user']) {
      const copy = await db.query.agentSkills.findFirst({
        where: and(eq(agentSkills.userId, userId), eq(agentSkills.identifier, member.plugins[0])),
      });
      expect(copy).toMatchObject({
        resources,
        zipFileHash: 'archive-v1',
        content: 'Read references/guide.md',
      });
    }
  });

  it('keeps identical approved resources on resave but rejects changed resources until explicitly reapproved', async () => {
    const source = await sourceMember();
    const first = await importSuperGroupTemplateMember(db, admin, {
      agentId: source.id,
      publishResourceSkills: [identifier],
    });
    await importSuperGroupTemplateMember(db, admin, { agentId: source.id });
    const nextResources = { 'references/new.md': { fileHash: 'reference-v2', size: 8 } };
    await db
      .update(agentSkills)
      .set({ resources: nextResources })
      .where(and(eq(agentSkills.userId, admin), eq(agentSkills.identifier, identifier)));
    const revision = (await getSuperGroupTemplate(db)).revision;
    await expect(
      importSuperGroupTemplateMember(db, admin, { agentId: source.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await getSuperGroupTemplate(db)).revision).toBe(revision);
    await importSuperGroupTemplateMember(db, admin, {
      agentId: source.id,
      publishResourceSkills: [identifier],
    });
    const copy = await db.query.agentSkills.findFirst({
      where: and(
        eq(agentSkills.userId, customer),
        eq(agentSkills.identifier, first.member.plugins[0]),
      ),
    });
    expect(copy?.resources).toEqual(nextResources);
  });

  it('rejects missing stored resources atomically even with publication approval', async () => {
    const source = await sourceMember();
    await db.delete(globalFiles).where(eq(globalFiles.hashId, 'reference-v1'));
    const revision = (await getSuperGroupTemplate(db)).revision;
    await expect(
      importSuperGroupTemplateMember(db, admin, {
        agentId: source.id,
        publishResourceSkills: [identifier],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await getSuperGroupTemplate(db)).revision).toBe(revision);
  });

  it('does not let publication approval bypass administrator or source ownership checks', async () => {
    const source = await sourceMember();
    await expect(
      importSuperGroupTemplateMember(db, customer, {
        agentId: source.id,
        publishResourceSkills: [identifier],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db.update(agents).set({ userId: customer }).where(eq(agents.id, source.id));
    await expect(
      importSuperGroupTemplateMember(db, admin, {
        agentId: source.id,
        publishResourceSkills: [identifier],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
