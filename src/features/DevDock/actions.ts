import { confirmModal, toast } from '@lobehub/ui/base-ui';

import { isDesktop } from '@/const/version';
import { getUserStoreState } from '@/store/user';

export const triggerResetOnboarding = () => {
  confirmModal({
    content: '清除当前用户的新手引导进度，让引导流程重新开始。',
    okButtonProps: { danger: true },
    okText: '重置引导',
    onOk: async () => {
      try {
        await getUserStoreState().resetOnboarding();
      } catch (error) {
        console.error('[DevDock] Failed to reset user onboarding:', error);
        toast.error({ title: '新手引导重置失败' });
        return;
      }

      if (isDesktop) {
        toast.success({ title: '已重置新手引导' });
      } else {
        window.location.href = '/onboarding';
      }
    },
    title: '重置新手引导？',
  });
};

export const triggerOpenDevtools = () => {
  void import('@/services/electron/devtools').then((m) => m.electronDevtoolsService.openDevtools());
};
