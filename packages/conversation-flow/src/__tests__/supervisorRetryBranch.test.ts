import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import type { Message } from '../types/shared';

describe('supervisor retry branches', () => {
  it.each([{ isSupervisor: true }, { orchestrationRole: 'supervisor' }])(
    'keeps the selected reply renderable with metadata %j',
    (metadata) => {
      const messages = [
        { id: 'user', role: 'user', content: '在么', metadata: { activeBranchIndex: 1 } },
        { id: 'old', role: 'assistant', parentId: 'user', content: '旧回复', metadata },
        { id: 'retry', role: 'assistant', parentId: 'user', content: '重新生成的回复', metadata },
      ] as Message[];
      const reply = parse(messages).flatList.find((message) => message.id === 'retry');
      expect(reply?.role).toBe('supervisor');
      expect(reply?.children).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'retry', content: '重新生成的回复' }),
        ]),
      );
    },
  );
});
