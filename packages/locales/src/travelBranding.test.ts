import { describe, expect, it } from 'vitest';

import enChat from '../../../locales/en-US/chat.json';
import enCommon from '../../../locales/en-US/common.json';
import enDiscover from '../../../locales/en-US/discover.json';
import enHotkey from '../../../locales/en-US/hotkey.json';
import enMemory from '../../../locales/en-US/memory.json';
import enSetting from '../../../locales/en-US/setting.json';
import zhAgent from '../../../locales/zh-CN/agent.json';
import zhAuth from '../../../locales/zh-CN/auth.json';
import zhChat from '../../../locales/zh-CN/chat.json';
import zhCommon from '../../../locales/zh-CN/common.json';
import zhDiscover from '../../../locales/zh-CN/discover.json';
import zhHotkey from '../../../locales/zh-CN/hotkey.json';
import zhMemory from '../../../locales/zh-CN/memory.json';
import zhMessenger from '../../../locales/zh-CN/messenger.json';
import zhNotification from '../../../locales/zh-CN/notification.json';
import zhOAuth from '../../../locales/zh-CN/oauth.json';
import zhPlugin from '../../../locales/zh-CN/plugin.json';
import zhSetting from '../../../locales/zh-CN/setting.json';
import defaultAgent from './default/agent';
import defaultAuth from './default/auth';
import defaultChat from './default/chat';
import defaultCommon from './default/common';
import defaultDiscover from './default/discover';
import defaultHotkey from './default/hotkey';
import defaultMemory from './default/memory';
import defaultMessenger from './default/messenger';
import defaultNotification from './default/notification';
import defaultOAuth from './default/oauth';
import defaultPlugin from './default/plugin';
import defaultSetting from './default/setting';

const visibleText = (resource: Record<string, string>) => Object.values(resource).join('\n');

const locallyBrandedKeys = [
  [defaultAuth, zhAuth, ['profile.sso.unlink.title']],
  [defaultOAuth, zhOAuth, ['consent.scope.openid', 'consent.thirdParty.notice']],
  [
    defaultChat,
    zhChat,
    ['plus.search.appSearchDesc', 'sharePage.menu.goToLobeHub', 'sharePageDisclaimer'],
  ],
  [
    defaultSetting,
    zhSetting,
    [
      'apps.cli.desc',
      'apps.messenger.desc',
      'apps.title',
      'memory.enabled.desc',
      'notification.im.desc',
      'notification.im.platform.desc',
      'skillStore.tabs.lobehub',
      'tools.builtins.lobe-image-generation.description',
      'workspace.apiKey.upgrade.benefits.integration.desc',
      'workspace.waitlistPage.goHome',
    ],
  ],
  [
    defaultAgent,
    zhAgent,
    [
      'channel.comingSoonDesc',
      'channel.connectionError.connection_closed',
      'channel.connectionError.upstream_unavailable',
      'channel.messengerPromo.desc',
    ],
  ],
  [
    defaultMessenger,
    zhMessenger,
    [
      'messenger.detail.commands.feedback',
      'messenger.detail.commands.start',
      'messenger.discord.connectModal.description',
      'messenger.discord.installBlocked.suggestion',
      'messenger.discord.installBlocked.withName',
      'messenger.discord.installBlocked.withoutName',
      'messenger.linkModal.instructions',
      'messenger.list.discord.description',
      'messenger.list.telegram.description',
      'messenger.list.wechat.description',
      'messenger.slack.connectModal.description',
      'messenger.slack.connections.disconnectConfirm',
      'messenger.slack.installBlocked.withName',
      'messenger.slack.installBlocked.withoutName',
      'messenger.subtitle',
      'messenger.unlinkConfirm',
      'messenger.unlinkConfirmWechat',
      'messenger.wechat.error.alreadyLinkedToOther',
      'verify.confirm.conflict.description',
      'verify.confirm.fields.lobeHubAccount',
      'verify.confirm.noAgents',
      'verify.confirm.relink.description',
      'verify.error.alreadyConsumed',
      'verify.error.alreadyLinkedToOther',
      'verify.error.unlinkBeforeRelink',
      'verify.signInRequired',
      'verify.success.backToLobeHub',
    ],
  ],
  [
    defaultPlugin,
    zhPlugin,
    [
      'builtins.lobe-message.apiDescription.listMessengerPlatforms',
      'builtins.lobe-message.apiDescription.listMessengers',
      'protocolInstall.stdio.commandExecution.description',
      'skillDetail.trustWarning',
    ],
  ],
  [
    defaultNotification,
    zhNotification,
    ['email.footer.preference', 'email.footer.system', 'workspace_waitlist_approved'],
  ],
] as const;

describe('travel group owner branding', () => {
  it.each([
    ['default chat', defaultChat],
    ['default common', defaultCommon],
    ['default discover', defaultDiscover],
    ['default hotkey', defaultHotkey],
    ['default memory', defaultMemory],
    ['default setting', defaultSetting],
    ['en-US chat', enChat],
    ['en-US common', enCommon],
    ['en-US discover', enDiscover],
    ['en-US hotkey', enHotkey],
    ['en-US memory', enMemory],
    ['en-US setting', enSetting],
  ])('uses Travel Group Owner AI in %s visible values', (_name, resource) => {
    expect(visibleText(resource)).not.toMatch(/Lobe ?AI/);
  });

  it.each([
    ['zh-CN chat', zhChat],
    ['zh-CN common', zhCommon],
    ['zh-CN discover', zhDiscover],
    ['zh-CN hotkey', zhHotkey],
    ['zh-CN memory', zhMemory],
    ['zh-CN setting', zhSetting],
  ])('uses 旅游群主AI in %s visible values', (_name, resource) => {
    expect(visibleText(resource)).not.toMatch(/Lobe ?AI/);
  });

  it('keeps the default inbox title aligned in both languages', () => {
    expect(defaultChat['inbox.title']).toBe('Travel Group Owner AI');
    expect(enChat['inbox.title']).toBe('Travel Group Owner AI');
    expect(zhChat['inbox.title']).toBe('旅游群主AI');
  });

  it.each(locallyBrandedKeys)(
    'removes the upstream product name from local customer surfaces %#',
    (fallbackResource, zhResource, keys) => {
      for (const key of keys) {
        const fallbackValue = fallbackResource[key];
        if (typeof fallbackValue === 'string') {
          expect(fallbackValue, key).not.toMatch(/LobeHub|Lobe ?AI|LobeChat/);
        }
        expect(zhResource[key], key).not.toMatch(/LobeHub|Lobe ?AI|LobeChat/);
      }
    },
  );

  it('keeps external product names and the deployed Slack handle intact', () => {
    expect(zhSetting['tools.builtins.lobe-skill-store.description']).toContain('LobeHub 技能市场');
    expect(zhSetting['settingSystemTools.tools.lobehub.desc']).toContain('LobeHub CLI');
    expect(zhAgent['channel.imessage.description']).toContain('LobeHub Desktop');
    expect(zhMessenger['messenger.list.slack.description']).toContain('@LobeHub');
    expect(zhMessenger['messenger.slack.installBlocked.suggestion']).toContain('@LobeHub');
  });
});
