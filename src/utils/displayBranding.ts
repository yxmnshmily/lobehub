import { BRANDING_NAME } from '@lobechat/business-const';
import type { PostProcessorModule } from 'i18next';

/** Brand prose without changing executable snippets, links or external account handles. */
export const displayBranding = (text: string): string =>
  text.replaceAll(
    /(`{3,}[\s\S]*?`{3,}|`[^`\n]*`|https?:\/\/[^\s<>"')]+|[\w.+-]+@[\w.-]+|@[\w/-]+)|(?<![\w./@-])LobeHub(?![\w/-]|\.[a-z])/gi,
    (match, protectedText: string | undefined) => protectedText ?? BRANDING_NAME,
  );

/** Applied after interpolation, including lazy namespaces and defaultValue labels. */
export const displayBrandingPostProcessor: PostProcessorModule = {
  name: 'displayBranding',
  process: displayBranding,
  type: 'postProcessor',
};
