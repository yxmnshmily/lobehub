import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { AsyncTaskError, AsyncTaskErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { CONTENT_POLICY_ERROR_MESSAGE } from './contentPolicyError';
import { categorizeImageGenerationError } from './imageError';

describe('categorizeImageGenerationError', () => {
  it.each([
    [
      400,
      'Image request parameters were rejected. Check the model parameter schema before retrying.',
    ],
    [
      422,
      'Image request parameters were rejected. Check the model parameter schema before retrying.',
    ],
    [403, 'Image generation permission was denied. Check provider account and model access.'],
    [
      429,
      'The provider rejected the request due to a rate or quota limit. Check provider limits before retrying.',
    ],
  ])('distinguishes HTTP %s failures without exposing provider secrets', (status, message) => {
    const result = categorizeImageGenerationError({
      error: {
        status,
        message: 'upstream secret sk-private at https://internal.test?token=private',
      },
      isAborted: false,
      isEditingImage: false,
    });
    expect(result.errorMessage).toBe(message);
    expect(JSON.stringify(result)).not.toMatch(/sk-private|internal.test|token=private/);
  });

  it('should map runtime content policy violations to async content moderation errors', () => {
    const result = categorizeImageGenerationError({
      error: {
        error: {
          providerReason: 'IMAGE_PROHIBITED_CONTENT',
          reasonCode: 'google_image_content_policy_violation',
        },
        errorType: AgentRuntimeErrorType.ProviderContentPolicyViolation,
      },
      isAborted: false,
      isEditingImage: false,
    });

    expect(result).toEqual({
      errorMessage: CONTENT_POLICY_ERROR_MESSAGE,
      errorType: AsyncTaskErrorType.ProviderContentModeration,
    });
  });

  it('should redact provider text-only image responses as server errors', () => {
    const result = categorizeImageGenerationError({
      error: {
        error: {
          message: "I'm just a language model and can't help with that.",
          reasonCode: 'google_image_text_only_response',
        },
        errorType: AgentRuntimeErrorType.ProviderNoImageGenerated,
      },
      isAborted: false,
      isEditingImage: false,
    });

    expect(result).toEqual({
      errorMessage: AsyncTaskErrorType.ServerError,
      errorType: AsyncTaskErrorType.ServerError,
    });
  });

  it('should redact provider refusal reasons when the runtime classified an explicit refusal', () => {
    const result = categorizeImageGenerationError({
      error: {
        error: {
          message: 'No image generated: The requested output format is not supported.',
          reasonCode: 'google_image_generation_refused',
        },
        errorType: AgentRuntimeErrorType.ProviderNoImageGenerated,
      },
      isAborted: false,
      isEditingImage: false,
    });

    expect(result).toEqual({
      errorMessage: AsyncTaskErrorType.ServerError,
      errorType: AsyncTaskErrorType.ServerError,
    });
  });

  it.each([
    [
      'provider permission error',
      {
        error: { message: 'provider rejected sk-private-provider-key' },
        errorType: AgentRuntimeErrorType.PermissionDenied,
      },
      AsyncTaskErrorType.InvalidProviderAPIKey,
    ],
    [
      'database error',
      { message: 'postgresql://admin:private-password@internal-db/image' },
      AsyncTaskErrorType.ServerError,
    ],
    [
      'network error',
      {
        message: 'network request failed at https://internal-provider.test?token=private',
        name: 'NetworkError',
      },
      AsyncTaskErrorType.ServerError,
    ],
    [
      'wrapped async task error',
      new AsyncTaskError(
        AsyncTaskErrorType.SubscriptionPlanLimit,
        'billing account secret=private',
      ),
      AsyncTaskErrorType.SubscriptionPlanLimit,
    ],
  ])('should project a fixed public message for %s', (_label, error, expectedType) => {
    const result = categorizeImageGenerationError({
      error,
      isAborted: false,
      isEditingImage: false,
    });

    expect(result).toEqual({
      errorMessage: expectedType,
      errorType: expectedType,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /sk-private|private-password|internal-provider|billing account secret/,
    );
  });

  it('should not trust a provider-supplied content policy message', () => {
    const result = categorizeImageGenerationError({
      error: new Error('provider moderation failed'),
      isAborted: false,
      isEditingImage: false,
      providerContentPolicyMessage:
        'blocked by https://internal-moderation.test?api_key=private-policy-key',
    });

    expect(result).toEqual({
      errorMessage: CONTENT_POLICY_ERROR_MESSAGE,
      errorType: AsyncTaskErrorType.ProviderContentModeration,
    });
  });

  it('should keep generic no-image provider responses as server errors', () => {
    const result = categorizeImageGenerationError({
      error: {
        errorType: AgentRuntimeErrorType.ProviderNoImageGenerated,
      },
      isAborted: false,
      isEditingImage: false,
    });

    expect(result).toEqual({
      errorMessage:
        'The provider did not return an image. This may be due to content review. Try a milder prompt or another model.',
      errorType: AsyncTaskErrorType.ServerError,
    });
  });
});
