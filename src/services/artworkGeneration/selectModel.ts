import type { EnabledProviderWithModels } from '@/types/aiProvider';

/**
 * When Volcengine is unavailable, Nano Banana 2 Lite leads: it accepts multiple style-reference images
 * (gpt-image-2 caps `imageUrls` at one) and is the cheapest per image, which
 * is what the one-click brand-style avatar path relies on.
 */
const PREFERRED_ARTWORK_MODELS = ['gemini-3.1-flash-lite-image', 'gpt-image-2'];

// Image variants of chat models carry an `:image` suffix (e.g.
// `gemini-3.1-flash-lite-image:image`), standalone image models do not.
const baseModelId = (id: string) => id.split(':')[0];

export const selectAgentArtworkModel = (providers: EnabledProviderWithModels[]) => {
  // Use the site's preferred image provider, but only its enabled image models.
  const volcengine = providers.find(
    ({ id, children }) => id === 'volcengine' && children.length > 0,
  );
  if (volcengine) return { model: volcengine.children[0], provider: volcengine };

  for (const preferred of PREFERRED_ARTWORK_MODELS) {
    for (const provider of providers) {
      const model = provider.children.find(({ id }) => baseModelId(id) === preferred);
      if (model) return { model, provider };
    }
  }

  const provider = providers[0];
  const model = provider?.children[0];

  return provider && model ? { model, provider } : undefined;
};
