// @vitest-environment node
import type { SkillManifest } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentSkills, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentSkillModel } from '../agentSkill';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-skill-model-test-user-id';
const otherUserId = 'agent-skill-model-test-user-id-2';
const agentSkillModel = new AgentSkillModel(serverDB, userId);
const otherUserSkillModel = new AgentSkillModel(serverDB, otherUserId);

// Helper to create valid manifest for tests
const createManifest = (overrides?: Partial<SkillManifest>): SkillManifest => ({
  description: 'Test skill description',
  name: 'Test Skill',
  ...overrides,
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('AgentSkillModel', () => {
  describe('create', () => {
    it('should create a new agent skill', async () => {
      const params = {
        name: 'Test Skill',
        description: 'A test skill',
        identifier: 'test.skill',
        source: 'user' as const,
        manifest: createManifest({ version: '1.0.0' }),
        content: '# Test Skill Content',
      };

      const skill = await agentSkillModel.create(params);

      expect(skill).toMatchObject(params);
      expect(skill.id).toBeDefined();
    });

    it('should idempotently create and upgrade a product skill without replacing resources', async () => {
      const first = await agentSkillModel.ensureByIdentifier({
        content: 'old content',
        description: 'old description',
        identifier: 'tourism-copywriting',
        manifest: createManifest({ name: '旅游文案技能' }),
        name: '旅游文案技能',
        source: 'builtin',
      });
      await serverDB
        .update(agentSkills)
        .set({ resources: { 'reference.md': { hash: 'abc' } as any } })
        .where(eq(agentSkills.id, first.id));

      const upgraded = await agentSkillModel.ensureByIdentifier({
        content: 'new content',
        description: 'new description',
        identifier: 'tourism-copywriting',
        manifest: createManifest({ name: '旅游文案技能', version: '1.0.0' }),
        name: '旅游文案技能',
        source: 'builtin',
      });

      expect(upgraded).toMatchObject({
        content: 'new content',
        description: 'new description',
        id: first.id,
        identifier: 'tourism-copywriting',
        resources: { 'reference.md': { hash: 'abc' } },
      });
      expect((await agentSkillModel.findAll()).total).toBe(1);
    });

    it('should rename an existing product skill by identifier without creating a second row', async () => {
      const first = await agentSkillModel.ensureByIdentifier({
        content: 'old content',
        description: 'old description',
        identifier: 'tourism-document-production',
        manifest: createManifest({ name: '旧行程技能' }),
        name: '旧行程技能',
        source: 'builtin',
      });

      const renamed = await agentSkillModel.ensureByIdentifier({
        content: 'new content',
        description: 'new description',
        identifier: 'tourism-document-production',
        manifest: createManifest({ name: '行程文档助理', version: '1.0.0' }),
        name: '行程文档助理',
        source: 'builtin',
      });

      expect(renamed).toMatchObject({
        content: 'new content',
        id: first.id,
        name: '行程文档助理',
      });
      expect((await agentSkillModel.findAll()).total).toBe(1);
    });

    it('should isolate the same product skill identifier by user', async () => {
      const input = {
        content: 'content',
        description: 'description',
        identifier: 'tourism-video-production',
        manifest: createManifest({ name: '旅游视频技能' }),
        name: '旅游视频技能',
        source: 'builtin' as const,
      };
      const mine = await agentSkillModel.ensureByIdentifier(input);
      const theirs = await otherUserSkillModel.ensureByIdentifier(input);

      expect(theirs.id).not.toBe(mine.id);
      expect(await agentSkillModel.findByIdentifier(input.identifier)).toMatchObject({
        id: mine.id,
      });
      expect(await otherUserSkillModel.findByIdentifier(input.identifier)).toMatchObject({
        id: theirs.id,
      });
    });
  });

  describe('delete', () => {
    it('should delete an agent skill by id', async () => {
      const { id } = await serverDB
        .insert(agentSkills)
        .values({
          name: 'To Delete',
          description: 'To delete skill',
          identifier: 'to.delete',
          source: 'user',
          manifest: createManifest(),
          userId,
        })
        .returning()
        .then((res) => res[0]);

      await agentSkillModel.delete(id);

      const skill = await serverDB.query.agentSkills.findFirst({
        where: eq(agentSkills.id, id),
      });
      expect(skill).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('should find an agent skill by id', async () => {
      const { id } = await serverDB
        .insert(agentSkills)
        .values({
          name: 'Find Me',
          description: 'Find me skill',
          identifier: 'find.me',
          source: 'user',
          manifest: createManifest(),
          userId,
        })
        .returning()
        .then((res) => res[0]);

      const skill = await agentSkillModel.findById(id);
      expect(skill).toBeDefined();
      expect(skill?.id).toBe(id);
    });

    it('should return undefined for non-existent id', async () => {
      const skill = await agentSkillModel.findById('non-existent-id');
      expect(skill).toBeUndefined();
    });
  });

  describe('findByIdentifier', () => {
    it('should find an agent skill by identifier', async () => {
      await serverDB.insert(agentSkills).values({
        name: 'By Identifier',
        description: 'By identifier skill',
        identifier: 'by.identifier',
        source: 'user',
        manifest: createManifest(),
        userId,
      });

      const skill = await agentSkillModel.findByIdentifier('by.identifier');
      expect(skill).toBeDefined();
      expect(skill?.identifier).toBe('by.identifier');
    });
  });

  describe('findAll', () => {
    it('should find all agent skills for user', async () => {
      await serverDB.insert(agentSkills).values([
        {
          name: 'Skill 1',
          description: 'Skill 1 description',
          identifier: 'skill.1',
          source: 'user',
          manifest: createManifest(),
          userId,
        },
        {
          name: 'Skill 2',
          description: 'Skill 2 description',
          identifier: 'skill.2',
          source: 'market',
          manifest: createManifest(),
          userId,
        },
      ]);

      const skills = await agentSkillModel.findAll();
      expect(skills.data).toHaveLength(2);
      expect(skills.total).toBe(2);
    });
  });

  describe('findByIds', () => {
    it('should find agent skills by ids', async () => {
      const inserted = await serverDB
        .insert(agentSkills)
        .values([
          {
            name: 'Skill A',
            description: 'Skill A description',
            identifier: 'skill.a',
            source: 'user',
            manifest: createManifest(),
            userId,
          },
          {
            name: 'Skill B',
            description: 'Skill B description',
            identifier: 'skill.b',
            source: 'user',
            manifest: createManifest(),
            userId,
          },
          {
            name: 'Skill C',
            description: 'Skill C description',
            identifier: 'skill.c',
            source: 'user',
            manifest: createManifest(),
            userId,
          },
        ])
        .returning();

      const ids = [inserted[0].id, inserted[2].id];
      const skills = await agentSkillModel.findByIds(ids);

      expect(skills).toHaveLength(2);
    });

    it('should return empty array for empty ids', async () => {
      const skills = await agentSkillModel.findByIds([]);
      expect(skills).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('should update an agent skill', async () => {
      const { id } = await serverDB
        .insert(agentSkills)
        .values({
          name: 'Original Name',
          description: 'Original description',
          identifier: 'original',
          source: 'user',
          manifest: createManifest(),
          userId,
        })
        .returning()
        .then((res) => res[0]);

      await agentSkillModel.update(id, { name: 'Updated Name' });

      const updated = await serverDB.query.agentSkills.findFirst({
        where: eq(agentSkills.id, id),
      });
      expect(updated?.name).toBe('Updated Name');
    });
  });

  describe('listBySource', () => {
    it('should list agent skills by source', async () => {
      await serverDB.insert(agentSkills).values([
        {
          name: 'User Skill',
          description: 'User skill description',
          identifier: 'user.skill',
          source: 'user',
          manifest: createManifest(),
          userId,
        },
        {
          name: 'Market Skill',
          description: 'Market skill description',
          identifier: 'market.skill',
          source: 'market',
          manifest: createManifest(),
          userId,
        },
        {
          name: 'Builtin Skill',
          description: 'Builtin skill description',
          identifier: 'builtin.skill',
          source: 'builtin',
          manifest: createManifest(),
          userId,
        },
      ]);

      const userSkills = await agentSkillModel.listBySource('user');
      expect(userSkills.data).toHaveLength(1);
      expect(userSkills.data[0].source).toBe('user');

      const marketSkills = await agentSkillModel.listBySource('market');
      expect(marketSkills.data).toHaveLength(1);
    });
  });

  describe('search', () => {
    it('should search agent skills by name', async () => {
      await serverDB.insert(agentSkills).values([
        {
          name: 'Coding Wizard',
          description: 'Coding wizard skill',
          identifier: 'coding',
          source: 'user',
          manifest: createManifest(),
          userId,
        },
        {
          name: 'Writing Helper',
          description: 'Writing helper skill',
          identifier: 'writing',
          source: 'user',
          manifest: createManifest(),
          userId,
        },
      ]);

      const results = await agentSkillModel.search('Coding');
      expect(results.data).toHaveLength(1);
      expect(results.data[0].name).toBe('Coding Wizard');
    });

    it('should search agent skills by description', async () => {
      await serverDB.insert(agentSkills).values([
        {
          name: 'Skill A',
          description: 'Helps with coding tasks',
          identifier: 'a',
          source: 'user',
          manifest: createManifest(),
          userId,
        },
        {
          name: 'Skill B',
          description: 'Helps with writing',
          identifier: 'b',
          source: 'user',
          manifest: createManifest(),
          userId,
        },
      ]);

      const results = await agentSkillModel.search('coding');
      expect(results.data).toHaveLength(1);
      expect(results.total).toBe(1);
    });
  });

  describe('findByName', () => {
    it('should find a skill by name', async () => {
      await serverDB.insert(agentSkills).values({
        name: 'Unique Skill Name',
        description: 'A unique skill',
        identifier: 'unique-skill',
        source: 'user',
        manifest: createManifest(),
        userId,
      });

      const result = await agentSkillModel.findByName('Unique Skill Name');
      expect(result).toBeDefined();
      expect(result?.name).toBe('Unique Skill Name');
    });

    it('should return undefined for non-existent name', async () => {
      const result = await agentSkillModel.findByName('Non Existent');
      expect(result).toBeUndefined();
    });

    it('should not find skills from other users', async () => {
      const otherUserId = 'other-skill-user';
      await serverDB.insert(users).values({ id: otherUserId });
      await serverDB.insert(agentSkills).values({
        name: 'Other Skill',
        description: 'Other skill desc',
        identifier: 'other-skill',
        source: 'user',
        manifest: createManifest(),
        userId: otherUserId,
      });

      const result = await agentSkillModel.findByName('Other Skill');
      expect(result).toBeUndefined();
    });

    it('matches case-insensitively so model casing drift still resolves', async () => {
      await serverDB.insert(agentSkills).values({
        name: 'agent-browser',
        description: 'browser CLI',
        identifier: 'lobe-agent-browser',
        source: 'user',
        manifest: createManifest(),
        userId,
      });

      for (const query of ['agent-browser', 'Agent-Browser', 'AGENT-BROWSER']) {
        const result = await agentSkillModel.findByName(query);
        expect(result?.name).toBe('agent-browser');
      }
    });
  });
});
