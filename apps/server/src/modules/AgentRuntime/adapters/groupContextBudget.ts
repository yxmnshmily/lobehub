import { countContextTokens } from '@lobechat/context-engine';
import type { ChatStreamPayload } from '@lobechat/model-runtime';
import type { UIChatMessage } from '@lobechat/types';

/** Last resort after summarization: change only this request, never stored messages/files. */
export function fitGroupContextBudget(
  messages: (ChatStreamPayload['messages'][number] & { id?: string })[],
  tools: unknown[],
  contextWindow: number,
  userMessageIds: readonly string[],
  maxOutputTokens = 0,
  sourceMessageIds = messages.map((message) => message.id),
) {
  const window = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 128_000;
  const outputReserve = Math.max(
    Math.ceil(window * 0.2),
    Number.isFinite(maxOutputTokens) ? maxOutputTokens : 0,
  );
  const inputBudget = Math.max(0, window - outputReserve);
  // Media bytes/URLs are not text tokens. Reserve capacity per media item instead;
  // this remains an estimate, not a provider-specific image/audio/video tokenizer.
  const mediaReserves: number[] = [];
  const estimatedMessages = messages.map((message) => {
    let mediaReserve = 0;
    const content = Array.isArray(message.content)
      ? message.content.map((part) => {
          if (['image_url', 'audio_url', 'video_url'].includes(part.type)) {
            mediaReserve += 4096;
            return { type: part.type };
          }
          return part;
        })
      : message.content;
    mediaReserves.push(mediaReserve);
    return { content: JSON.stringify({ ...message, content }), role: 'user' };
  });
  // Provider-format tool_calls and reasoning must be counted as well as text.
  const accounting = countContextTokens({
    messages: estimatedMessages as UIChatMessage[],
    tools,
  });
  let remaining = accounting.rawTotal + mediaReserves.reduce((sum, tokens) => sum + tokens, 0);
  const withinBudget = () => Math.ceil(remaining * accounting.driftMultiplier) <= inputBudget;
  if (withinBudget()) return { messages, removedMessages: 0 };

  // Peer replies and task callbacks can become role=user in the context engine.
  // Only the pre-transform identities can mark a real user-turn boundary.
  const userIds = new Set(userMessageIds);
  const isUserBoundary = (_message: ChatStreamPayload['messages'][number], index: number) =>
    Boolean(sourceMessageIds[index] && userIds.has(sourceMessageIds[index]!));
  const latestUser = messages.findLastIndex(isUserBoundary);
  const removed = new Set<number>();
  // Boundaries are whole user turns: never separate an assistant tool call from
  // its results. Keep all system instructions and the entire active task suffix.
  for (let start = 0; start < latestUser && !withinBudget();) {
    let end = start + 1;
    while (end < latestUser && !isUserBoundary(messages[end], end)) end++;
    for (let index = start; index < end; index++) {
      if (['system', 'developer'].includes(messages[index].role)) continue;
      removed.add(index);
      remaining -= accounting.messages[index].total + mediaReserves[index];
    }
    start = end;
  }

  if (!withinBudget()) {
    throw new Error(
      '当前任务、工具或文件内容仍超过模型上下文，请缩小本次任务或分段读取文件；聊天记录未删除。',
    );
  }
  return {
    messages: messages.filter((_, index) => !removed.has(index)),
    removedMessages: removed.size,
  };
}
