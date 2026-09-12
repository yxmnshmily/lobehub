import debug from 'debug';

type AiAgentDebugEvent =
  | 'ai_agent.execution.aborted'
  | 'ai_agent.execution.completed'
  | 'ai_agent.execution.error'
  | 'ai_agent.lifecycle'
  | 'ai_agent.operation.created'
  | 'ai_agent.request.accepted';

const baseLog = debug('lobe-server:ai-agent-service');

const classifyEvent = (template: string): AiAgentDebugEvent => {
  const normalized = template.toLowerCase();

  if (normalized.includes('aborted')) return 'ai_agent.execution.aborted';
  if (normalized.includes('failed') || normalized.includes('error')) {
    return 'ai_agent.execution.error';
  }
  if (normalized.includes('created operation')) {
    return 'ai_agent.operation.created';
  }
  if (normalized.includes('completed')) {
    return 'ai_agent.execution.completed';
  }
  if (normalized.includes('identifier=') || normalized.includes('request accepted')) {
    return 'ai_agent.request.accepted';
  }

  return 'ai_agent.lifecycle';
};

const safeMetric = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Array.isArray(value)) return value.length;
  if (value instanceof Map || value instanceof Set) return value.size;
  return value == null ? 0 : 1;
};

/**
 * Keep AI-agent diagnostics useful without emitting prompts, credentials,
 * user-controlled identifiers, provider errors, or other raw runtime values.
 */
export const aiAgentDebug = (template: string, ...fields: unknown[]): void => {
  baseLog(classifyEvent(template), ...fields.map(safeMetric));
};

type AiAgentOperationalErrorEvent =
  'ai_agent.bridge.group_member.error' | 'ai_agent.bridge.subagent.error';

/** Critical, always-visible breadcrumbs with a fixed event and no raw values. */
export const aiAgentOperationalError = (event: AiAgentOperationalErrorEvent): void => {
  console.error(event);
};
