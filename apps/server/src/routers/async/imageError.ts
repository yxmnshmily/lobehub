import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { AsyncTaskError, AsyncTaskErrorType } from '@lobechat/types';

import { CONTENT_POLICY_ERROR_MESSAGE, getContentPolicyErrorMessage } from './contentPolicyError';

const IMAGE_EDITING_NO_IMAGE_MESSAGE = [
  'The provider did not return an image.',
  'This may be due to content review.',
  'Try a safer source image or a milder prompt.',
].join(' ');
const IMAGE_GENERATION_NO_IMAGE_MESSAGE = [
  'The provider did not return an image.',
  'This may be due to content review.',
  'Try a milder prompt or another model.',
].join(' ');

interface CategorizeImageGenerationErrorOptions {
  error: ImageGenerationErrorLike;
  isAborted: boolean;
  isEditingImage: boolean;
  providerContentPolicyMessage?: string;
}

interface ImageGenerationErrorLike {
  body?: string | { detail: string };
  error?: {
    message?: string;
    providerReason?: string;
    reasonCode?: string;
    responseId?: string;
  };
  errorType?: string;
  message?: string;
  name?: string;
  status?: number;
}

interface CategorizedImageGenerationError {
  errorMessage: string;
  errorType: AsyncTaskErrorType;
}

const publicError = (
  errorType: AsyncTaskErrorType,
  errorMessage: string = errorType,
): CategorizedImageGenerationError => ({ errorMessage, errorType });

const isAsyncTaskErrorType = (value: unknown): value is AsyncTaskErrorType =>
  typeof value === 'string' &&
  Object.values(AsyncTaskErrorType).includes(value as AsyncTaskErrorType);

const publicAsyncTaskError = (errorType: AsyncTaskErrorType): CategorizedImageGenerationError =>
  publicError(
    errorType,
    errorType === AsyncTaskErrorType.ProviderContentModeration
      ? CONTENT_POLICY_ERROR_MESSAGE
      : errorType,
  );

export const categorizeImageGenerationError = ({
  error,
  isAborted,
  isEditingImage,
  providerContentPolicyMessage,
}: CategorizeImageGenerationErrorOptions): CategorizedImageGenerationError => {
  // Handle Comfy UI errors
  if (error.errorType === AgentRuntimeErrorType.ComfyUIServiceUnavailable) {
    return publicAsyncTaskError(AsyncTaskErrorType.InvalidProviderAPIKey);
  }

  if (error.errorType === AgentRuntimeErrorType.ComfyUIBizError) {
    return publicAsyncTaskError(AsyncTaskErrorType.ServerError);
  }

  if (error.errorType === AgentRuntimeErrorType.ComfyUIWorkflowError) {
    return publicAsyncTaskError(AsyncTaskErrorType.ServerError);
  }

  if (error.errorType === AgentRuntimeErrorType.ComfyUIModelError) {
    return publicAsyncTaskError(AsyncTaskErrorType.ModelNotFound);
  }

  if (error.errorType === AgentRuntimeErrorType.ConnectionCheckFailed) {
    return publicAsyncTaskError(AsyncTaskErrorType.ServerError);
  }

  if (error.errorType === AgentRuntimeErrorType.PermissionDenied) {
    return publicAsyncTaskError(AsyncTaskErrorType.InvalidProviderAPIKey);
  }

  if (error.errorType === AgentRuntimeErrorType.ModelNotFound) {
    return publicAsyncTaskError(AsyncTaskErrorType.ModelNotFound);
  }

  if (providerContentPolicyMessage) {
    return publicAsyncTaskError(AsyncTaskErrorType.ProviderContentModeration);
  }

  if (error.errorType === AgentRuntimeErrorType.ProviderContentPolicyViolation) {
    return publicAsyncTaskError(AsyncTaskErrorType.ProviderContentModeration);
  }

  if (error.errorType === AgentRuntimeErrorType.ProviderNoImageGenerated) {
    if (
      error.error?.reasonCode === 'google_image_text_only_response' ||
      error.error?.reasonCode === 'google_image_generation_refused'
    ) {
      return publicAsyncTaskError(AsyncTaskErrorType.ServerError);
    }

    return {
      errorMessage: isEditingImage
        ? IMAGE_EDITING_NO_IMAGE_MESSAGE
        : IMAGE_GENERATION_NO_IMAGE_MESSAGE,
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  // FIXME: 401 errors should be handled in agentRuntime for better practice
  if (error.errorType === AgentRuntimeErrorType.InvalidProviderAPIKey || error?.status === 401) {
    return publicAsyncTaskError(AsyncTaskErrorType.InvalidProviderAPIKey);
  }

  const fallbackContentPolicyMessage = getContentPolicyErrorMessage(error);
  if (fallbackContentPolicyMessage) {
    return {
      errorMessage: fallbackContentPolicyMessage,
      errorType: AsyncTaskErrorType.ProviderContentModeration,
    };
  }

  if (error instanceof AsyncTaskError) {
    return publicAsyncTaskError(
      isAsyncTaskErrorType(error.name) ? error.name : AsyncTaskErrorType.ServerError,
    );
  }

  if (isAborted || error.message?.includes('aborted')) {
    return {
      errorMessage: AsyncTaskErrorType.Timeout,
      errorType: AsyncTaskErrorType.Timeout,
    };
  }

  if (error.message?.includes('timeout') || error.name === 'TimeoutError') {
    return {
      errorMessage: AsyncTaskErrorType.Timeout,
      errorType: AsyncTaskErrorType.Timeout,
    };
  }

  if (error.message?.includes('network') || error.name === 'NetworkError') {
    return publicAsyncTaskError(AsyncTaskErrorType.ServerError);
  }

  return publicAsyncTaskError(AsyncTaskErrorType.ServerError);
};
