import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Conversation ChatInput mobile variant', () => {
  it('renders MobileChatInput for the mobile SPA', async () => {
    const source = await readFile(path.join(__dirname, 'index.tsx'), 'utf8');

    expect(source).toContain('MobileChatInput');
    expect(source).toContain('mobile ? (');
    expect(source).toContain('<MobileChatInput sendAreaPrefix={businessSendAreaPrefix} />');
  });
});
