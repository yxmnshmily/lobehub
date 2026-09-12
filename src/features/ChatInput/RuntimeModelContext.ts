import { createContext } from 'react';

export interface RuntimeModel {
  model: string;
  provider: string;
  retry?: () => void;
  status: 'loading' | 'ready' | 'error';
}

/** Authoritative, read-only model for a hosted conversation. Never hydrate the caller's agent store. */
export const RuntimeModelContext = createContext<RuntimeModel | undefined>(undefined);

export const getRuntimeModelLabel = ({ model, status }: RuntimeModel) => {
  if (model) return model;
  if (status === 'loading') return '群模型加载中…';
  if (status === 'error') return '群模型加载失败，点击重试';
  return '群模型未配置';
};
