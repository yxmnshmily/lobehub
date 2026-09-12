import type { MessageActionSlot } from './types';

// Shared by standalone and grouped replies; individual actions retain their
// own permission gates. Text actions in a group target its latest text block.
export const ASSISTANT_MENU: MessageActionSlot[] = [
  'edit',
  'copy',
  'comments',
  'collapse',
  'divider',
  'tts',
  'translate',
  'divider',
  'share',
  'select',
  'divider',
  { children: ['copyMessageId', 'copyOperationId', 'saveAsEvalCase'], key: 'advanced' },
  'divider',
  'regenerate',
  'delAndRegenerate',
  'del',
];
