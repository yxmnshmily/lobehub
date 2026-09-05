import type { StreamEvent } from '@/server/modules/AgentRuntime/StreamEventManager';

export type WebsiteAiStreamEvent =
  | {
      member?: string;
      message?: string;
      phase?: 'completed' | 'failed' | 'started';
      status: string;
      type: 'status';
    }
  | { text: string; type: 'delta' }
  | {
      id: string;
      kind: 'document' | 'file' | 'image' | 'video' | 'work';
      status?: 'pending' | 'succeeded';
      taskId?: string;
      title?: string;
      type: 'artifact';
      url?: string;
    }
  | { reason?: string; type: 'done' }
  | { code: string; message: string; type: 'error' };

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const PUBLIC_ARTIFACT_ID_PATTERN = /^[\p{L}\p{N}_-]{1,128}$/u;
const PUBLIC_ARTIFACT_ROUTES = ['/f/', '/lobehub/page/', '/lobehub/resources/'] as const;

const publicArtifactId = (value: unknown): string | undefined => {
  const id = stringValue(value)?.normalize('NFC');
  return id && PUBLIC_ARTIFACT_ID_PATTERN.test(id) ? id : undefined;
};

const hasUnsafeUrlCharacter = (value: string) =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === '\\' || codePoint <= 32 || codePoint === 127;
  });

const publicTerminalReason = (value: unknown) => {
  const reason = stringValue(value);
  if (reason === 'done' || reason === 'completed') return 'completed';
  return reason === 'interrupted' ? reason : 'error';
};

type WebsiteAiArtifactKind = Extract<WebsiteAiStreamEvent, { type: 'artifact' }>['kind'];

const artifactKind = (value: unknown): WebsiteAiArtifactKind => {
  if (value === 'document' || value === 'file' || value === 'image' || value === 'video') {
    return value;
  }
  return 'work';
};

const travelGenerationTitle = (kind: WebsiteAiArtifactKind, pending = false) => {
  const title =
    kind === 'image'
      ? '旅游图片'
      : kind === 'video'
        ? '旅游视频'
        : kind === 'document'
          ? '旅游文档'
          : '旅游作品';
  return `${title}${pending ? '制作中' : '制作结果'}`;
};

export const normalizeWebsiteAiArtifactUrl = (
  value: unknown,
  publicOrigin?: string,
): string | undefined => {
  const raw = stringValue(value);
  if (!raw || hasUnsafeUrlCharacter(raw) || raw.startsWith('//')) return undefined;

  try {
    const relative = raw.startsWith('/');
    const parsed = relative ? new URL(raw, 'http://website-ai.internal') : new URL(raw);
    if (!relative) {
      if (!publicOrigin || parsed.username || parsed.password) return undefined;
      const expectedOrigin = new URL(publicOrigin);
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        !['http:', 'https:'].includes(expectedOrigin.protocol) ||
        parsed.origin !== expectedOrigin.origin
      ) {
        return undefined;
      }
    }

    const route = PUBLIC_ARTIFACT_ROUTES.find((prefix) => parsed.pathname.startsWith(prefix));
    if (!route) return undefined;
    const encodedId = parsed.pathname.slice(route.length);
    if (!encodedId || encodedId.includes('/')) return undefined;

    let decodedId = encodedId;
    for (let depth = 0; depth < 4; depth += 1) {
      const next = decodeURIComponent(decodedId);
      if (next === decodedId) break;
      decodedId = next;
    }
    const id = publicArtifactId(decodedId);
    return id ? `${route}${encodeURIComponent(id)}` : undefined;
  } catch {
    return undefined;
  }
};

const artifactsFromMessages = (
  messages: unknown,
  publicOrigin?: string,
): WebsiteAiStreamEvent[] => {
  if (!Array.isArray(messages)) return [];

  const found = new Map<string, WebsiteAiStreamEvent>();
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const item = message as Record<string, unknown>;

    for (const raw of Array.isArray(item.works) ? item.works : []) {
      if (!raw || typeof raw !== 'object') continue;
      const work = raw as Record<string, unknown>;
      const id = stringValue(work.id);
      if (!id) continue;
      const kind = artifactKind(work.type ?? work.kind);
      const suppliedUrl = stringValue(work.url);
      found.set(`${kind}:${id}`, {
        id,
        kind,
        title: stringValue(work.title ?? work.name),
        type: 'artifact',
        url: suppliedUrl
          ? normalizeWebsiteAiArtifactUrl(suppliedUrl, publicOrigin)
          : kind === 'document' && publicArtifactId(id)
            ? `/lobehub/page/${encodeURIComponent(id.normalize('NFC'))}`
            : undefined,
      });
    }

    for (const [field, kind] of [
      ['fileList', 'file'],
      ['imageList', 'image'],
      ['videoList', 'video'],
    ] as const) {
      for (const raw of Array.isArray(item[field]) ? item[field] : []) {
        if (!raw || typeof raw !== 'object') continue;
        const file = raw as Record<string, unknown>;
        const id = stringValue(file.id);
        if (!id) continue;
        found.set(`${kind}:${id}`, {
          id,
          kind,
          title: stringValue(file.name ?? file.alt),
          type: 'artifact',
          url: publicArtifactId(id) ? `/f/${encodeURIComponent(id.normalize('NFC'))}` : undefined,
        });
      }
    }

    const pluginState =
      item.pluginState && typeof item.pluginState === 'object'
        ? (item.pluginState as Record<string, unknown>)
        : undefined;
    for (const raw of Array.isArray(pluginState?.artifacts) ? pluginState.artifacts : []) {
      if (!raw || typeof raw !== 'object') continue;
      const artifact = raw as Record<string, unknown>;
      const id = stringValue(artifact.id);
      if (!id) continue;
      const kind = artifactKind(artifact.kind);
      found.set(`${kind}:${id}`, {
        id,
        kind,
        title: stringValue(artifact.title),
        type: 'artifact',
        url: normalizeWebsiteAiArtifactUrl(artifact.url, publicOrigin),
      });
    }

    const generationState =
      pluginState?.travelGeneration && typeof pluginState.travelGeneration === 'object'
        ? (pluginState.travelGeneration as Record<string, unknown>)
        : undefined;
    const taskId = stringValue(generationState?.id);
    const generationKind = artifactKind(generationState?.type);
    const generationStatus = stringValue(generationState?.status);
    if (taskId && generationStatus === 'pending') {
      found.set(`${generationKind}:${taskId}`, {
        id: taskId,
        kind: generationKind,
        status: 'pending',
        taskId,
        title: travelGenerationTitle(generationKind, true),
        type: 'artifact',
        url: undefined,
      });
    }
    if (taskId && generationStatus === 'succeeded') {
      for (const raw of Array.isArray(generationState?.artifacts)
        ? generationState.artifacts
        : []) {
        if (!raw || typeof raw !== 'object') continue;
        const artifact = raw as Record<string, unknown>;
        const id = stringValue(artifact.id);
        if (!id) continue;
        const kind = artifactKind(artifact.type);
        found.set(`${kind}:${id}`, {
          id,
          kind,
          status: 'succeeded',
          taskId,
          title: stringValue(artifact.name) ?? travelGenerationTitle(kind),
          type: 'artifact',
          url: normalizeWebsiteAiArtifactUrl(artifact.url, publicOrigin),
        });
      }
    }
  }
  return [...found.values()];
};

interface WebsiteAiProgressMember {
  id: string;
  name: string;
}

export interface WebsiteAiProgressTracker {
  consume: (event: StreamEvent) => WebsiteAiStreamEvent[];
}

const groupMemberIds = (tool: unknown): string[] => {
  if (!tool || typeof tool !== 'object') return [];
  const item = tool as Record<string, unknown>;
  if (item.identifier !== 'lobe-group-management') return [];

  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(typeof item.arguments === 'string' ? item.arguments : '{}');
    if (!parsed || typeof parsed !== 'object') return [];
    args = parsed as Record<string, unknown>;
  } catch {
    return [];
  }

  if (
    item.apiName === 'speak' ||
    item.apiName === 'delegate' ||
    item.apiName === 'executeAgentTask'
  ) {
    return stringValue(args.agentId) ? [args.agentId as string] : [];
  }
  if (item.apiName === 'broadcast') {
    return Array.isArray(args.agentIds)
      ? args.agentIds.flatMap((id) => (stringValue(id) ? [id] : []))
      : [];
  }
  if (item.apiName === 'executeAgentTasks' && Array.isArray(args.tasks)) {
    return args.tasks.flatMap((task) => {
      if (!task || typeof task !== 'object') return [];
      const id = stringValue((task as Record<string, unknown>).agentId);
      return id ? [id] : [];
    });
  }
  return [];
};

const progressMessage = (member: string, phase: 'completed' | 'failed' | 'started') => {
  if (phase === 'started') return `${member}正在执行……`;
  if (phase === 'completed') return `${member}已完成。`;
  return `${member}未完成，已交由群主 AI 继续处理。`;
};

export const createWebsiteAiProgressTracker = (
  members: WebsiteAiProgressMember[],
): WebsiteAiProgressTracker => {
  const names = new Map(members.map(({ id, name }) => [id, name]));
  const phases = new Map<string, 'completed' | 'failed' | 'started'>();

  const emit = (id: string, phase: 'completed' | 'failed' | 'started') => {
    const member = names.get(id);
    if (!member || phases.get(id) === phase) return [];
    if (phase === 'started' && phases.has(id)) return [];
    phases.set(id, phase);
    return [
      {
        member,
        message: progressMessage(member, phase),
        phase,
        status: 'member_progress',
        type: 'status',
      } satisfies WebsiteAiStreamEvent,
    ];
  };

  return {
    consume(event) {
      const data = event.data && typeof event.data === 'object' ? event.data : {};
      const emitted: WebsiteAiStreamEvent[] = [];

      if (event.type === 'stream_chunk' && data.chunkType === 'tools_calling') {
        for (const tool of Array.isArray(data.toolsCalling) ? data.toolsCalling : []) {
          for (const id of groupMemberIds(tool)) emitted.push(...emit(id, 'started'));
        }
      }

      if (event.type === 'step_start' || event.type === 'agent_runtime_end') {
        for (const message of Array.isArray(data.uiMessages) ? data.uiMessages : []) {
          if (!message || typeof message !== 'object') continue;
          const item = message as Record<string, unknown>;
          const plugin = item.plugin;
          if (!plugin || typeof plugin !== 'object') continue;
          const state = item.pluginState;
          const status =
            state && typeof state === 'object'
              ? stringValue((state as Record<string, unknown>).status)
              : undefined;
          const phase =
            status === 'completed' || status === 'done'
              ? 'completed'
              : status === 'error' ||
                  status === 'failed' ||
                  item.content === 'Agent member(s) failed to start.'
                ? 'failed'
                : undefined;
          if (!phase) continue;
          for (const id of groupMemberIds(plugin)) emitted.push(...emit(id, phase));
        }
      }

      if (
        event.type === 'agent_runtime_end' &&
        (data.reason === 'error' || data.reason === 'interrupted')
      ) {
        for (const [id, phase] of phases) {
          if (phase === 'started') emitted.push(...emit(id, 'failed'));
        }
      }

      return emitted;
    },
  };
};

export const normalizeWebsiteAiStreamEvent = (
  event: StreamEvent,
  progress?: WebsiteAiProgressTracker,
  publicOrigin?: string,
): WebsiteAiStreamEvent[] => {
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  const progressEvents = progress?.consume(event) ?? [];

  if (event.type === 'stream_chunk' && data.chunkType === 'text' && stringValue(data.content)) {
    return [...progressEvents, { text: data.content, type: 'delta' }];
  }

  if (event.type === 'agent_runtime_init') {
    return [...progressEvents, { status: 'running', type: 'status' }];
  }

  if (event.type === 'agent_intervention_request') {
    return [...progressEvents, { status: 'waiting_input', type: 'status' }];
  }

  if (event.type === 'agent_runtime_end') {
    const reason = publicTerminalReason(data.reason);
    const artifacts = artifactsFromMessages(data.uiMessages, publicOrigin);
    if (reason === 'error' || reason === 'interrupted') {
      return [
        ...progressEvents,
        ...artifacts,
        {
          code: reason === 'interrupted' ? 'INTERRUPTED' : 'AGENT_ERROR',
          message: '本次 AI 任务未完成，请稍后重试。',
          type: 'error',
        },
        { reason, type: 'done' },
      ];
    }
    return [
      ...progressEvents,
      ...artifacts,
      { status: 'completed', type: 'status' },
      { reason, type: 'done' },
    ];
  }

  if (event.type === 'step_start') {
    return progressEvents.length > 0 ? progressEvents : [{ status: 'running', type: 'status' }];
  }
  return progressEvents;
};
