import { produce } from 'immer';

import type { MessageToolCall, MessageToolCallChunk } from '../types';
import { MessageToolCallSchema } from '../types';

// Some providers (e.g. NVIDIA NIM serving z-ai/glm5 and qwen3.5-MoE, plus some
// aihubmix-style proxies) emit the opening tool_call delta with
// `function.name = null` or `''` as a start-of-tool marker. The real name is
// carried by a subsequent delta. Passing `null` through the strict
// MessageToolCallSchema throws ZodError mid-stream and kills the entire
// operation. Coerce to '' so parsing succeeds; the merge logic below patches
// the name in once a later delta supplies it. See .
//
// The same applies to `function.arguments`: some providers open a tool_call
// delta with only the id/name/type and stream `arguments` in a following
// delta (or omit it for zero-arg calls). A missing `arguments` also fails the
// strict schema and aborts the run before the first real argument delta can
// merge in. Coerce to '' as well; the merge logic concatenates once it arrives,
// and the downstream tool executor treats '' as empty args.
const normalizeChunkForParse = <T extends Omit<MessageToolCallChunk, 'index'>>(chunk: T): T => {
  if (chunk.function) {
    const { name, arguments: args, ...rest } = chunk.function;
    // Always carry name/arguments forward when present; only missing (null /
    // undefined) values are coerced to '' as start-of-tool markers.
    return { ...chunk, function: { ...rest, name: name ?? '', arguments: args ?? '' } };
  }
  return chunk;
};

export const parseToolCalls = (origin: MessageToolCall[], value: MessageToolCallChunk[]) =>
  produce(origin, (draft) => {
    // if there is no origin, we should parse all the value and set it to draft
    if (draft.length === 0) {
      draft.push(...value.map((item) => MessageToolCallSchema.parse(normalizeChunkForParse(item))));
      return;
    }

    // if there is origin, we should merge the value to the origin
    value.forEach(({ index, ...item }) => {
      // First, try to find existing tool call by id (more reliable than index for parallel tool calls)
      const existingByIdIndex = item.id ? draft.findIndex((d) => d.id === item.id) : -1;

      if (existingByIdIndex !== -1) {
        // Found existing tool call with same id - merge arguments and (if the
        // first delta had null/empty name) patch in the name from this delta.
        if (item.function?.arguments) {
          draft[existingByIdIndex].function.arguments += item.function.arguments;
        }
        if (item.function?.name && !draft[existingByIdIndex].function.name) {
          draft[existingByIdIndex].function.name = item.function.name;
        }
      } else if (!draft?.[index]) {
        // No item at this index - insert new tool call
        draft?.splice(index, 0, MessageToolCallSchema.parse(normalizeChunkForParse(item)));
      } else if (item.id && draft[index].id !== item.id) {
        // Different id at same index - this is a new parallel tool call (e.g., from Gemini)
        // Push to end of draft instead of overwriting
        draft.push(MessageToolCallSchema.parse(normalizeChunkForParse(item)));
      } else {
        // Same index and same id (or no id) - merge arguments and patch name.
        if (item.function?.arguments) {
          draft[index].function.arguments += item.function.arguments;
        }
        if (item.function?.name && !draft[index].function.name) {
          draft[index].function.name = item.function.name;
        }
      }
    });
  });
