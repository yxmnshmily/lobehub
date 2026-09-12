import { useEditor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { Alert, Avatar, Button, Text } from '@lobehub/ui/base-ui';
import { Crown, PlayIcon, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import ProfileSkeleton from '@/components/Skeleton/Profile';
import { EditorCanvas } from '@/features/EditorCanvas';
import ModelSelect from '@/features/ModelSelect';
import { useIsMobile } from '@/hooks/useIsMobile';
import { parseAsString, useQueryState } from '@/hooks/useQueryParam';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { lambdaQuery } from '@/libs/trpc/client';
import MobileSidebar from '@/routes/(main)/group/_layout/MobileSidebar';
import type { MemberGroupSummary } from '@/routes/(main)/group/_layout/useGroupRouteAccess';
import { ProfileHeaderBar } from '@/routes/(main)/group/profile/features/Header';
import { useServerConfigStore } from '@/store/serverConfig';

import JoinedGroupSidebar, { SuperGroupSidebarBody } from './JoinedGroupSidebar';
import { ProfileDocument, ProfileSurface } from './ProfileSurface';

/** Member data adapter: reuse the administrator canvas and tabs without loading private config. */
export default function MemberProfile({
  group,
  showDesktopSidebar = true,
}: {
  group: Pick<MemberGroupSummary, 'groupId' | 'title' | 'avatar'>;
  showDesktopSidebar?: boolean;
}) {
  const editor = useEditor();
  const narrowViewport = useIsMobile();
  const mobileClient = useServerConfigStore((state) => state.isMobile);
  const mobile = mobileClient || narrowViewport;
  const { t } = useTranslation(['chat', 'setting']);
  const router = useQueryRoute();
  const [tab, setTab] = useQueryState('tab', parseAsString.withDefault('group'));
  const query = lambdaQuery.groupMembership.listParticipants.useQuery(
    { groupId: group.groupId, limit: 50, offset: 0 },
    { retry: false, refetchOnWindowFocus: true },
  );
  const assistants = query.data?.assistants ?? [];
  const selected = assistants.find((agent) => agent.id === tab);
  const title = selected?.title || group.title || '超级工作群';
  const avatar = selected ? selected.avatar : group.avatar;
  const tabs = [
    { id: 'group', title: t('group.profile.groupSettings'), icon: <Users size={16} /> },
    ...assistants.map((agent) => ({
      id: agent.id,
      title: agent.isSupervisor ? t('group.profile.supervisor') : agent.title || '成员',
      avatar: agent.avatar || undefined,
      icon: agent.isSupervisor ? <Crown size={16} /> : undefined,
    })),
  ];
  const selectTopic = (id: string, messageId?: string) =>
    router.push(
      `/group/${group.groupId}/${id}${messageId ? `#${encodeURIComponent(messageId)}` : ''}`,
    );
  return (
    <>
      {!mobile && showDesktopSidebar && (
        <JoinedGroupSidebar groupId={group.groupId} onSelectTopic={selectTopic} />
      )}
      <MobileSidebar
        disabled={!mobile}
        sidebar={<SuperGroupSidebarBody groupId={group.groupId} onSelectTopic={selectTopic} />}
      >
        <ProfileSurface
          header={
            <ProfileHeaderBar activeId={selected ? tab : 'group'} items={tabs} onChange={setTab} />
          }
        >
          {query.isLoading ? (
            <ProfileSkeleton variant="group" />
          ) : query.isError ? (
            <Alert
              action={<Button onClick={() => void query.refetch()}>重试</Button>}
              title="群组档案加载失败"
              type="error"
            />
          ) : (
            <ProfileDocument
              status={<Text type="secondary">只读 · 群组配置由管理员维护</Text>}
              actions={
                <Button
                  icon={PlayIcon}
                  type="primary"
                  onClick={() => router.push(`/group/${group.groupId}`)}
                >
                  {t('startConversation', { ns: 'setting' })}
                </Button>
              }
              controls={
                selected?.model ? (
                  <ModelSelect
                    disabled
                    initialWidth
                    value={{ model: selected.model, provider: selected.provider || undefined }}
                  />
                ) : undefined
              }
              identity={
                <Flexbox gap={16} paddingBlock={16}>
                  {avatar ? (
                    <Avatar avatar={avatar} size={72} />
                  ) : (
                    <ProductLogo size={72} type="flat" />
                  )}
                  <h1
                    style={{ fontSize: 36, fontWeight: 600, margin: 0, overflowWrap: 'anywhere' }}
                  >
                    {title}
                  </h1>
                  {selected?.subtitle && <Text type="secondary">{selected.subtitle}</Text>}
                </Flexbox>
              }
            >
              <EditorCanvas
                disabled
                contentRevision={query.dataUpdatedAt}
                editable={false}
                editor={editor}
                entityId={`member-profile:${group.groupId}:${selected?.id || 'group'}`}
                editorData={{
                  content:
                    selected?.description ||
                    (selected
                      ? '暂无介绍'
                      : assistants
                          .map(
                            (agent) =>
                              `## ${agent.title || '成员'}\n\n${agent.description || '暂无介绍'}`,
                          )
                          .join('\n\n')),
                }}
              />
            </ProfileDocument>
          )}
        </ProfileSurface>
      </MobileSidebar>
    </>
  );
}
