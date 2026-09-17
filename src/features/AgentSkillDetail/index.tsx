'use client';

import { type SkillResourceTreeNode } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronLeft, DotIcon, ExternalLinkIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PublishedTime from '@/components/PublishedTime';
import { ArticleSkeleton } from '@/components/Skeleton';
import SkillAvatar from '@/components/SkillAvatar';
import FileTree, { FileTreeSkeleton } from '@/features/FileTree';
import { useToolStore } from '@/store/tool';

import ContentViewer from './ContentViewer';

const styles = createStaticStyles(({ css, cssVar }) => ({
  description: css`
    overflow: hidden;

    margin: 0;

    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  divider: css`
    flex-shrink: 0;
    width: 0.5px;
    background: ${cssVar.colorBorderSecondary};
  `,
  drillBack: css`
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;

    min-height: 44px;
    padding-inline: 8px;
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
  `,
  drillContent: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
  `,
  drillPath: css`
    overflow: hidden;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  drillTree: css`
    overflow-y: auto;
    flex: 1;
    padding: 8px;
  `,
  left: css`
    overflow-y: auto;
    flex-shrink: 0;
    width: 240px;
    padding: 8px;
  `,
  meta: css`
    flex-shrink: 0;
    padding: 16px;
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
  `,
  name: css`
    font-size: 16px;
    font-weight: 500;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
  right: css`
    container-type: size;
    overflow: auto;
    flex: 1;
  `,
}));

interface AgentSkillDetailProps {
  /**
   * 下钻模式（默认开启）：文件树与文件内容不再左右并排，而是"树 → 点文件
   * 进入内容（带返回）"。传 false 可回到旧的双栏并排。
   */
  drilldown?: boolean;
  skillId: string;
}

const buildContentMap = (nodes: SkillResourceTreeNode[] = []): Record<string, string> => {
  const map: Record<string, string> = {};
  const walk = (items: SkillResourceTreeNode[]) => {
    for (const node of items) {
      if (node.type === 'file' && node.content !== undefined) {
        map[node.path] = node.content;
      } else if (node.children) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return map;
};

const AgentSkillDetail = memo<AgentSkillDetailProps>(({ drilldown = true, skillId }) => {
  const { t } = useTranslation('setting');
  /* 下钻模式初始停在文件树层；双栏模式保持默认打开 SKILL.md 的原行为。 */
  const [selectedFile, setSelectedFile] = useState<string | null>(drilldown ? null : 'SKILL.md');
  const { data, isLoading } = useToolStore((s) => s.useFetchAgentSkillDetail)(skillId);

  const skillDetail = data?.skillDetail;
  const resourceTree = data?.resourceTree;
  const contentMap = useMemo(() => buildContentMap(resourceTree), [resourceTree]);

  if (isLoading) {
    return (
      <Flexbox style={{ height: '100%', overflow: 'hidden' }}>
        <div className={styles.meta}>
          <ArticleSkeleton rows={1} style={{ margin: 0 }} title={220} />
        </div>
        {drilldown ? (
          <div className={styles.drillTree}>
            <FileTreeSkeleton rows={9} />
          </div>
        ) : (
          <Flexbox horizontal style={{ flex: 1, overflow: 'hidden' }}>
            <div className={styles.left}>
              <FileTreeSkeleton rows={9} />
            </div>
            <div className={styles.divider} />
            <div className={styles.right}>
              <ArticleSkeleton rows={8} style={{ padding: 16 }} />
            </div>
          </Flexbox>
        )}
      </Flexbox>
    );
  }

  const version = skillDetail?.manifest?.version;
  const description = skillDetail?.description || skillDetail?.manifest?.description;
  const repository = skillDetail?.manifest?.repository;
  const sourceUrl = skillDetail?.manifest?.sourceUrl;

  return (
    <Flexbox style={{ height: '100%', overflow: 'hidden' }}>
      {skillDetail && (
        <div className={styles.meta}>
          <Flexbox horizontal align={'center'} gap={12}>
            <SkillAvatar size={40} />
            <Flexbox flex={1} gap={4} style={{ overflow: 'hidden' }}>
              <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                <Flexbox horizontal align={'center'} className={styles.description} gap={4}>
                  <span className={styles.name}>{skillDetail.name}</span>
                  {version && (
                    <>
                      <Icon icon={DotIcon} />
                      <span>v{version}</span>
                    </>
                  )}
                  <Icon icon={DotIcon} />
                  {t('agentSkillDetail.updatedAt')}{' '}
                  <PublishedTime
                    date={new Date(skillDetail.updatedAt).toISOString()}
                    template={'MMM DD, YYYY'}
                  />
                </Flexbox>
                {(repository || sourceUrl) && (
                  <Flexbox horizontal align={'center'} gap={2} style={{ flexShrink: 0 }}>
                    {repository && (
                      <a href={repository} rel="noreferrer" target={'_blank'}>
                        <ActionIcon
                          fill={cssVar.colorTextDescription}
                          icon={Github}
                          title={t('agentSkillDetail.repository')}
                        />
                      </a>
                    )}
                    {sourceUrl && (
                      <a href={sourceUrl} rel="noreferrer" target={'_blank'}>
                        <ActionIcon
                          icon={ExternalLinkIcon}
                          title={t('agentSkillDetail.sourceUrl')}
                        />
                      </a>
                    )}
                  </Flexbox>
                )}
              </Flexbox>
              {description && <p className={styles.description}>{description}</p>}
            </Flexbox>
          </Flexbox>
        </div>
      )}
      {drilldown ? (
        selectedFile === null ? (
          /* 下钻第 1 层：全宽文件树 */
          <div className={styles.drillTree}>
            <FileTree
              resourceTree={resourceTree || []}
              selectedFile={selectedFile ?? ''}
              onSelectFile={setSelectedFile}
            />
          </div>
        ) : (
          /* 下钻第 2 层：全宽文件内容，顶部带返回 */
          <div className={styles.drillContent} key={selectedFile}>
            <div className={styles.drillBack}>
              <ActionIcon
                icon={ChevronLeft}
                title={t('back', { ns: 'common' })}
                onClick={() => setSelectedFile(null)}
              />
              <span className={styles.drillPath}>{selectedFile}</span>
            </div>
            <div className={styles.right}>
              <ContentViewer
                contentMap={contentMap}
                selectedFile={selectedFile}
                skillDetail={skillDetail}
              />
            </div>
          </div>
        )
      ) : (
        <Flexbox horizontal style={{ flex: 1, overflow: 'hidden' }}>
          <div className={styles.left}>
            <FileTree
              resourceTree={resourceTree || []}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
            />
          </div>
          <div className={styles.divider} />
          <div className={styles.right} key={selectedFile}>
            <ContentViewer
              contentMap={contentMap}
              selectedFile={selectedFile}
              skillDetail={skillDetail}
            />
          </div>
        </Flexbox>
      )}
    </Flexbox>
  );
});

AgentSkillDetail.displayName = 'AgentSkillDetail';

export default AgentSkillDetail;
