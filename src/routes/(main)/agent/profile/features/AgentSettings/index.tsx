'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';

import { agentSettingsModalPresentation } from '@/features/AgentSetting';

import Content from './Content';

export const openAgentSettingsModal = (): ModalInstance =>
  createModal({
    content: <Content />,
    footer: null,
    maskClosable: true,
    ...agentSettingsModalPresentation,
  });
