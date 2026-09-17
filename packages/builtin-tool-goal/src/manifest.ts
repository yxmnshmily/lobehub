import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { GoalApiName } from './types';

export const GoalIdentifier = 'lobe-goal';

export const GoalManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Create and start a long-horizon goal with an editable acceptance plan. Use for an explicit goal request such as /goal, or a focused outcome needing sustained specialist collaboration and refinement, even for one artifact. Routine creative work such as a short text plus one image can be completed directly in conversation; a deliverable or a simple sequence alone does not require a goal. Do not turn ordinary questions or brainstorming into goals. It creates the goal in the current group when present, records acceptance criteria, and advances its coordinator. Once it succeeds, do not reproduce the work in this conversation; the goal owns execution; keep progress and available results accessible through the current conversation.',
      humanIntervention: 'never',
      name: GoalApiName.createGoal,
      parameters: {
        additionalProperties: false,
        properties: {
          criteria: {
            description:
              'Outcome-level acceptance checks. For a simple artifact, combine its explicit content, style and format requirements into an overall result check; separate genuinely independent outcomes or user-requested formal checks.',
            items: {
              additionalProperties: false,
              properties: {
                description: { type: 'string' },
                instruction: {
                  description: 'Detailed judging instruction. Omit for program checks.',
                  type: 'string',
                },
                onFail: { enum: ['auto_repair', 'manual'], type: 'string' },
                required: { type: 'boolean' },
                title: { type: 'string' },
                verifierConfig: { type: 'object' },
                verifierType: { enum: ['agent', 'llm', 'program'], type: 'string' },
              },
              required: ['title'],
              type: 'object',
            },
            type: 'array',
          },
          deadline: {
            description:
              'Optional ISO-8601 calendar deadline. Past it the coordinator stops dispatching new work and pauses the goal — use for long-horizon goals that must conclude by a date. Null means no user-specified deadline.',
            type: ['string', 'null'],
          },
          instruction: { description: 'Detailed task direction and constraints.', type: 'string' },
          maxIterations: {
            description:
              'Maximum attempts one task may take before the goal opens a decision gate. Default 3, minimum 2. Null means no user-specified cap.',
            type: ['number', 'null'],
          },
          maxTotalCost: {
            description: 'Optional total USD budget. Null means no user-specified cap.',
            type: ['number', 'null'],
          },
          name: { description: 'Short goal title.', type: 'string' },
        },
        required: ['name', 'instruction', 'criteria'],
        type: 'object',
      },
      renderDisplayControl: 'expand',
    },
    {
      name: GoalApiName.viewGoal,
      description:
        'Inspect an existing goal, its current work items and linked results in this conversation. Use its returned node and task identifiers for follow-up changes instead of creating duplicate work.',
      humanIntervention: 'never',
      parameters: {
        type: 'object',
        properties: {
          goalId: {
            type: 'string',
            description:
              'Existing goal ID, or its exact name in the current group when the ID is unavailable. Use the returned goalId for changes; disambiguate duplicate candidates first.',
          },
        },
        required: ['goalId'],
      },
    },
    {
      name: GoalApiName.reviseGoal,
      description:
        'Apply a requested revision to one existing goal work item, preserving the original goal/task IDs and result history. This interrupts affected running work and queues a new attempt for that item, actual dependents and final acceptance; unrelated completed work stays intact. Inspect with viewGoal first. Supply the full updated instruction for the item. Existing budget limits and a deliberate pause remain in force; managed planning may report a conflict.',
      humanIntervention: 'never',
      parameters: {
        type: 'object',
        properties: {
          goalId: { type: 'string', description: 'Existing goal ID.' },
          nodeId: {
            type: 'string',
            description: 'Task node ID returned by viewGoal, not the task ID.',
          },
          instruction: {
            type: 'string',
            description:
              'Complete revised instruction for this work item, preserving unchanged requirements.',
          },
          requirement: {
            type: 'string',
            description:
              'Optional complete revised goal requirement, only when the user changed the overall requirement. Existing structured acceptance criteria remain in force.',
          },
        },
        required: ['goalId', 'nodeId', 'instruction'],
      },
    },
    {
      name: GoalApiName.resumeGoal,
      description:
        'Continue an existing paused goal when the user asks to resume. Keeps its original work and budget limits; pending decisions still require resolution. Use reviseGoal for changes to completed results instead of replaying the goal.',
      humanIntervention: 'never',
      parameters: {
        type: 'object',
        properties: { goalId: { type: 'string', description: 'Existing goal ID.' } },
        required: ['goalId'],
      },
    },
  ],
  identifier: GoalIdentifier,
  meta: {
    avatar: '🎯',
    description: 'Plan and start goals with editable acceptance criteria',
    title: 'Goal',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
