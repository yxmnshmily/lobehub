'use client';

import { agentDisplayName } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo, use } from 'react';

import { GroupChatPresentation } from '@/features/SuperGroup/GroupChatPresentation';
import { GroupReplyAction, GroupSpeakingStatus } from '@/features/SuperGroup/GroupMessageQuote';

import FollowUpChips from '../FollowUp/FollowUpChips';
import { contextSelectors, useConversationStore } from '../store';
import Actions from './components/Actions';
import Avatar from './components/Avatar';
import ErrorContent from './components/ErrorContent';
import MessageContent from './components/MessageContent';
import Title from './components/Title';
import { styles } from './style';
import type { ChatItemProps } from './type';

const ChatItem = memo<ChatItemProps>(
  ({
    onAvatarClick,
    avatarProps,
    customAvatarRender,
    afterActions,
    actionAddon,
    actions,
    className,
    loading,
    message,
    placeholderMessage = '...',
    placement = 'left',
    avatar,
    error,
    showTitle,
    time,
    editing,
    messageExtra,
    children,
    customErrorRender,
    onDoubleClick,
    aboveMessage,
    belowMessage,
    showAvatar = true,
    titleAddon,
    disabled = false,
    id,
    style,
    ...rest
  }) => {
    const isUser = placement === 'right';
    const groupChat = use(GroupChatPresentation);
    const conversationKey = useConversationStore(contextSelectors.conversationKey);
    const isEmptyMessage =
      !message || String(message).trim() === '' || message === placeholderMessage;
    const errorContent = error && (
      <ErrorContent customErrorRender={customErrorRender} error={error} id={id} />
    );

    const avatarContent = (
      <Avatar
        alt={avatarProps?.alt || agentDisplayName(avatar, 'avatar')}
        loading={loading}
        shape={'square'}
        onClick={onAvatarClick}
        {...avatarProps}
        avatar={avatar}
      />
    );

    return (
      <Flexbox
        align={isUser ? 'flex-end' : 'flex-start'}
        className={cx('message-wrapper', styles.container, className)}
        data-group-bubble={groupChat ? placement : undefined}
        data-message-id={id}
        gap={8}
        paddingBlock={8}
        style={{
          paddingInlineStart: isUser ? 36 : 0,
          ...style,
        }}
        {...rest}
      >
        <Flexbox
          align={'center'}
          className={'message-header'}
          direction={isUser ? 'horizontal-reverse' : 'horizontal'}
          gap={8}
        >
          {(showAvatar || groupChat) &&
            (customAvatarRender ? customAvatarRender(avatar, avatarContent) : avatarContent)}
          <Title
            avatar={avatar}
            showTitle={showTitle || groupChat}
            time={time}
            titleAddon={
              groupChat ? (
                <>
                  {titleAddon}
                  <GroupSpeakingStatus loading={loading} />
                </>
              ) : (
                titleAddon
              )
            }
          />
        </Flexbox>
        <Flexbox
          className={'message-body'}
          gap={8}
          style={{
            maxWidth: groupChat ? undefined : '100%',
            overflow: 'hidden',
            position: 'relative',
            width: groupChat || isUser ? undefined : '100%',
          }}
        >
          {aboveMessage}
          {error && isEmptyMessage ? (
            errorContent
          ) : (
            <MessageContent
              disabled={disabled}
              editing={editing}
              id={id!}
              message={message}
              variant={isUser ? 'bubble' : undefined}
              messageExtra={
                <>
                  {errorContent}
                  {messageExtra}
                </>
              }
              onDoubleClick={onDoubleClick}
            >
              {children}
            </MessageContent>
          )}
          {belowMessage}
        </Flexbox>
        {id && conversationKey && (
          <FollowUpChips conversationKey={conversationKey} messageId={id} />
        )}
        {(actionAddon || actions || (groupChat && id)) && (
          <Actions
            actionAddon={actionAddon}
            placement={placement}
            actions={
              groupChat ? (
                <>
                  {actions}
                  {groupChat && id && !disabled && !editing && !loading && (
                    <GroupReplyAction id={id} name={agentDisplayName(avatar, '群成员')} />
                  )}
                </>
              ) : (
                actions
              )
            }
          />
        )}
        {afterActions && (
          <Flexbox
            style={{
              width: isUser ? undefined : '100%',
            }}
          >
            {afterActions}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default ChatItem;
