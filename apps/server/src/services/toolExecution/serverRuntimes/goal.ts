import {
  buildGoalRequirement,
  GoalIdentifier,
  resolveGoalAttemptBudget,
  resolveGoalScheduleConfig,
} from '@lobechat/builtin-tool-goal';
import { TRPCError } from '@trpc/server';

import { GoalService } from '@/server/services/goal';
import { advanceGoal } from '@/server/services/goal/advanceGoal';
import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';

import type { ServerRuntimeRegistration } from './types';

/**
 * Server-side `/goal`: create a Goal Graph and advance it once.
 *
 * It lives in its own runtime rather than on the task runtime because a goal is
 * no longer a task with a `goals` row attached — the graph owns the
 * decomposition and dispatches its own Work Tasks.
 */
export const goalRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Goal tool execution');
    }
    const { agentId, serverDB, userId, workspaceId } = context;

    return {
      viewGoal: async (args: { goalId: string }) => {
        try {
          const graph = await new GoalService(serverDB, userId, workspaceId ?? undefined).graph(
            args.goalId,
            context.groupId ?? undefined,
          );
          if (context.groupId && graph.goal.config?.groupId !== context.groupId)
            return { content: 'Goal not found in this conversation.', success: false };
          const summary = {
            goalId: graph.goal.id,
            title: graph.goal.title,
            status: graph.goal.status,
            requirement: graph.goal.requirement,
            work: graph.nodes
              .filter((node) => node.kind === 'task')
              .map((node) => ({
                nodeId: node.id,
                taskId: node.taskId,
                title: node.title,
                instruction: node.description,
                status: node.status,
              })),
            results: graph.workVersions,
          };
          return { content: JSON.stringify(summary), state: summary, success: true };
        } catch (error) {
          return {
            content:
              error instanceof TRPCError
                ? error.message
                : 'Could not read this goal. Check its identifier and access.',
            success: false,
          };
        }
      },
      resumeGoal: async (args: { goalId: string }) => {
        try {
          const service = new GoalService(serverDB, userId, workspaceId ?? undefined);
          const { goal: current } = await service.graph(args.goalId);
          if (context.groupId && current.config?.groupId !== context.groupId)
            return { content: 'Goal not found in this conversation.', success: false };
          if (current.status === 'achieved' || current.status === 'canceled')
            return {
              content:
                'This goal has ended. Use reviseGoal for a requested change to completed work.',
              success: false,
            };
          const goal = current.status === 'paused' ? await service.resume(args.goalId) : current;
          const state = { goalId: args.goalId, status: goal.status };
          if (goal.status !== 'running')
            return {
              content: `Goal status: ${goal.status}; resolve its pending work or decision before execution can continue.`,
              state,
              success: true,
            };
          try {
            await scheduleGoalAdvance({
              goalId: args.goalId,
              trigger: 'manual',
              userId,
              workspaceId: workspaceId ?? undefined,
            });
            return {
              content:
                'Existing goal queued to continue within its current budget. Results are not ready yet.',
              state,
              success: true,
            };
          } catch {
            return {
              content:
                'Goal is ready to continue, but scheduling failed. Retry this same goal; do not create another.',
              state,
              success: true,
            };
          }
        } catch {
          return {
            content: 'Could not resume this goal. Check its identifier and current status.',
            success: false,
          };
        }
      },
      reviseGoal: async (args: {
        goalId: string;
        instruction: string;
        nodeId: string;
        requirement?: string;
      }) => {
        try {
          const revision = await new GoalService(serverDB, userId, workspaceId ?? undefined).revise(
            args.goalId,
            {
              groupId: context.groupId ?? undefined,
              origin:
                context.groupId && context.topicId && agentId
                  ? { agentId, topicId: context.topicId }
                  : undefined,
              instruction: args.instruction,
              nodeId: args.nodeId,
              requirement: args.requirement,
            },
          );
          const state = {
            goalId: args.goalId,
            status: revision.goal.status,
            taskIds: revision.taskIds,
          };
          if (revision.goal.status !== 'running')
            return {
              content: `Revision saved to the existing work. Goal status: ${revision.goal.status}; execution has not resumed.`,
              state,
              success: true,
            };
          try {
            await scheduleGoalAdvance({
              goalId: args.goalId,
              trigger: 'manual',
              userId,
              workspaceId: workspaceId ?? undefined,
            });
            return {
              content:
                'Revision saved and queued on the existing work. The revised result is not ready yet.',
              state,
              success: true,
            };
          } catch {
            return {
              content:
                'Revision saved, but scheduling failed. Inspect the same goal before retrying; do not create another goal.',
              state,
              success: true,
            };
          }
        } catch (error) {
          return {
            content:
              error instanceof TRPCError
                ? error.message
                : 'Could not apply the revision. Inspect the existing goal; interrupted work remains paused.',
            success: false,
          };
        }
      },
      createGoal: async (args: {
        criteria: Array<{ description?: string; instruction?: string; title: string }>;
        deadline?: string | null;
        instruction: string;
        maxIterations?: number | null;
        maxTotalCost?: number | null;
        name: string;
      }) => {
        if (!agentId) return { content: 'A goal needs the current agent.', success: false };

        const drafts = (args.criteria ?? []).filter((item) => item.title?.trim());
        if (drafts.length === 0) {
          return { content: 'A goal needs at least one acceptance criterion.', success: false };
        }

        try {
          const goalService = new GoalService(serverDB, userId, workspaceId ?? undefined);
          const scheduleConfig = resolveGoalScheduleConfig(args.deadline);
          const graph = await goalService.create({
            agentId,
            createdByAgentId: agentId,
            config: {
              ...(context.groupId ? { groupId: context.groupId } : {}),
              ...(context.groupId && context.topicId
                ? {
                    origin: {
                      agentId,
                      topicId: context.topicId,
                      messageId: context.assistantMessageId,
                      operationId: context.operationId,
                      toolCallId: context.toolCallId,
                    },
                  }
                : {}),
              recovery: { maxAttemptsPerTask: resolveGoalAttemptBudget(args.maxIterations) },
              ...(scheduleConfig ? { schedule: scheduleConfig } : {}),
            },
            // `maxIterations` caps attempts on one Work; it is deliberately not
            // passed as `maxRounds`, which counts runs across every Work in the
            // graph and would strand later tasks that have not run at all.
            // Structured criteria persist alongside the prose requirement so the
            // goal page can edit them and the terminal acceptance runs exactly them.
            criteria: drafts,
            maxTotalCost: args.maxTotalCost ?? undefined,
            // No seed work: the coordinator plans the decomposition on first
            // advance, so a complex ask becomes several explorable directions
            // instead of one task that mirrors the whole request.
            problemDescription: args.instruction,
            requirement: buildGoalRequirement(args.name, drafts, args.instruction),
            title: args.name,
          });
          // The TRPC `goal.create` route queues this; calling the service
          // directly does not. Without it the "the server will pick it up"
          // promise below is false — outside queue mode there is no local timer
          // for the goal and no recurring sweep, so it would sit in `planning`
          // while the agent has been told not to create it again.
          await scheduleGoalAdvance({
            goalId: graph.goal.id,
            trigger: 'create',
            userId,
            workspaceId: workspaceId ?? undefined,
          });

          const created = `Goal "${graph.goal.title}" (${graph.goal.id}) created with ${drafts.length} acceptance criteria.`;
          const tail =
            'Execution continues in its own task; do not perform or reproduce the work in this conversation.';

          // The goal is committed. Kickoff failure must not be reported as
          // creation failure — an agent told the goal was not created makes
          // another one, and both then do the same paid work. `goal.create`
          // already queued an advance, so this is only about immediate feedback.
          try {
            // Advance until the coordinator is waiting on something other than a
            // tick — normally that is the first Work Task executing. From there
            // the goal keeps itself moving through the queued advances.
            const { result } = await advanceGoal({
              goalId: graph.goal.id,
              trigger: 'create',
              userId,
              workspaceId: workspaceId ?? undefined,
            });

            return {
              content: `${created} ${result.message}. ${tail}`,
              state: {
                goalId: graph.goal.id,
                name: args.name,
                startedAt: new Date().toISOString(),
                success: true,
                taskId: result.taskId,
              },
              success: true,
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'Could not start it right away';
            return {
              content: `${created} It has not started yet (${message}); the server will pick it up. Do not create it again. ${tail}`,
              state: {
                goalId: graph.goal.id,
                name: args.name,
                startedAt: new Date().toISOString(),
                success: true,
              },
              success: true,
            };
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to create the goal';
          return {
            content: `Could not create the goal: ${message}`,
            state: { name: args.name, success: false },
            success: false,
          };
        }
      },
    };
  },
  identifier: GoalIdentifier,
};
