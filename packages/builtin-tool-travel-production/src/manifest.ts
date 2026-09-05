import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { TravelProductionApiName } from './types';

export const TravelProductionIdentifier = 'lobe-travel-production';

export const TravelProductionManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Create customer-facing tourism copy through the controlled server-side production and billing pipeline.',
      name: TravelProductionApiName.generateCopy,
      parameters: {
        additionalProperties: false,
        properties: {
          prompt: {
            description: 'The tourism copy production request.',
            maxLength: 4000,
            minLength: 1,
            type: 'string',
          },
        },
        required: ['prompt'],
        type: 'object',
      },
    },
    {
      description:
        'Create a private user-owned tourism document through the controlled server-side production and billing pipeline.',
      name: TravelProductionApiName.generateDocument,
      parameters: {
        additionalProperties: false,
        properties: {
          prompt: {
            description: 'The tourism document production request.',
            maxLength: 4000,
            minLength: 1,
            type: 'string',
          },
          title: {
            description: 'Optional document title explicitly requested by the user.',
            maxLength: 120,
            minLength: 1,
            type: 'string',
          },
        },
        required: ['prompt'],
        type: 'object',
      },
    },
    {
      description:
        'Submit an authenticated tourism image generation task using the platform-managed model and ownership context.',
      name: TravelProductionApiName.generateImage,
      parameters: {
        additionalProperties: false,
        properties: {
          imageNum: {
            description: 'Generate exactly one image.',
            maximum: 1,
            minimum: 1,
            type: 'integer',
          },
          prompt: {
            description: 'The tourism image production prompt.',
            maxLength: 4000,
            minLength: 1,
            type: 'string',
          },
        },
        required: ['prompt'],
        type: 'object',
      },
    },
    {
      description:
        'Request authenticated tourism video generation; unavailable is returned until authoritative usage settlement is supported.',
      name: TravelProductionApiName.generateVideo,
      parameters: {
        additionalProperties: false,
        properties: {
          prompt: {
            description: 'The tourism video production prompt.',
            maxLength: 4000,
            minLength: 1,
            type: 'string',
          },
        },
        required: ['prompt'],
        type: 'object',
      },
    },
  ],
  identifier: TravelProductionIdentifier,
  meta: {
    avatar: '🎨',
    description: 'Controlled server-side tourism document and media production',
    title: '旅游创作',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
