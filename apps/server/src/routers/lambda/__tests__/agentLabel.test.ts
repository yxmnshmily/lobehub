// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPlatformAdminGuard = vi.hoisted(() => vi.fn());

// serverDatabase middleware calls getServerDB(); stub it (the model mock
// ignores the db handle anyway).
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(() => (opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('../_helpers/platformAdminGuard', () => ({
  requirePlatformAdmin: (opts: any) => mockPlatformAdminGuard(opts),
}));

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockSetAgentLabels = vi.fn();

vi.mock('@/database/models/agentLabel', () => ({
  AgentLabelModel: vi.fn(() => ({
    create: mockCreate,
    setAgentLabels: mockSetAgentLabels,
    update: mockUpdate,
  })),
}));

const { agentLabelRouter } = await import('../agentLabel');

/** Shaped like the driver error drizzle surfaces, nested behind `cause`. */
const uniqueViolation = (constraint: string) => {
  const error = new Error('duplicate key value violates unique constraint');
  (error as any).cause = { code: '23505', constraint };
  return error;
};

describe('agentLabelRouter', () => {
  const ctx: any = { serverDB: {}, userId: 'user-1', workspaceId: 'ws-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatformAdminGuard.mockImplementation((opts: any) => opts.next());
    mockSetAgentLabels.mockResolvedValue(['label-1']);
  });

  it('rejects label writes from an ordinary customer', async () => {
    mockCreate.mockResolvedValue({ id: 'label-1' });
    mockPlatformAdminGuard.mockRejectedValueOnce(
      new TRPCError({ code: 'FORBIDDEN', message: 'Platform administrator access is required' }),
    );

    await expect(
      agentLabelRouter.createCaller(ctx).createLabel({ name: 'Design' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  describe('setAgentLabels', () => {
    it('writes without requiring per-agent edit rights', async () => {
      // Labelling is list organization, not configuration, so it gates on the
      // `agent:update` role scope alone — a member may tag any agent they can
      // see, which is the point of a shared, groupable list. The viewer role
      // holds no such grant, and the model's `agentOwnership()` still keeps
      // another member's private agents unreachable.
      const caller = agentLabelRouter.createCaller(ctx);

      await caller.setAgentLabels({ agentId: 'agent-1', labelIds: ['label-1'] });

      expect(mockSetAgentLabels).toHaveBeenCalledWith('agent-1', ['label-1']);
    });
  });

  describe('duplicate label names', () => {
    it.each([['agent_labels_user_id_name_unique'], ['agent_labels_workspace_id_name_unique']])(
      'maps a %s violation on create to CONFLICT',
      async (constraint) => {
        mockCreate.mockRejectedValue(uniqueViolation(constraint));
        const caller = agentLabelRouter.createCaller(ctx);

        await expect(caller.createLabel({ name: 'Design' })).rejects.toMatchObject({
          code: 'CONFLICT',
          message: 'DUPLICATE_LABEL_NAME',
        });
      },
    );

    it('maps a violation on update to CONFLICT, covering rename and un-archive', async () => {
      mockUpdate.mockRejectedValue(uniqueViolation('agent_labels_workspace_id_name_unique'));
      const caller = agentLabelRouter.createCaller(ctx);

      await expect(
        caller.updateLabel({ id: 'label-1', value: { archived: false } }),
      ).rejects.toMatchObject({ code: 'CONFLICT', message: 'DUPLICATE_LABEL_NAME' });
    });

    it('leaves unrelated failures untouched', async () => {
      mockUpdate.mockRejectedValue(uniqueViolation('some_other_unique_index'));
      const caller = agentLabelRouter.createCaller(ctx);

      await expect(
        caller.updateLabel({ id: 'label-1', value: { name: 'Design' } }),
      ).rejects.not.toMatchObject({ code: 'CONFLICT' });
    });
  });
});
