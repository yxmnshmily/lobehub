/** Only list scenarios that have a real producer in this deployment. */
export const NOTIFICATION_EVENTS = [
  { type: 'task_run_completed', category: 'agent', title: '任务本轮运行结束' },
  { type: 'task_run_failed', category: 'agent', title: '任务本轮运行失败' },
  { type: 'credits_low', category: 'billing', title: '积分余额预警（低于10万）' },
  { type: 'credits_adjusted', category: 'billing', title: '积分账务调整' },
  { type: 'credits_returned', category: 'billing', title: '积分退回到账' },
  { type: 'credits_exhausted', category: 'billing', title: '积分消耗完毕' },
  { type: 'credits_top_up_completed', category: 'billing', title: '充值到账' },
  { type: 'image_generation_failed', category: 'generation', title: '图片生成失败' },
  { type: 'video_generation_failed', category: 'generation', title: '视频生成失败' },
  { type: 'image_generation_completed', category: 'generation', title: '图片生成完成' },
  { type: 'video_generation_completed', category: 'generation', title: '视频生成完成' },
  { type: 'agent_run_failed', category: 'agent', title: '助理任务失败' },
  { type: 'agent_run_completed', category: 'agent', title: '助理任务完成' },
  { type: 'agent_intervention_required', category: 'pending', title: '助理等待你的确认' },
  { type: 'task_assigned', category: 'pending', title: '有任务分配给你' },
  { type: 'resource_transfer_requested', category: 'pending', title: '资源移交待确认' },
  { type: 'agent_cron_job_completed', category: 'schedule', title: '计划任务成功' },
  { type: 'agent_cron_job_failed', category: 'schedule', title: '计划任务失败' },
  { type: 'topic_commented', category: 'workspace', title: '话题有新评论或回复' },
  { type: 'task_commented', category: 'workspace', title: '任务有新评论' },
  { type: 'resource_transfer_accepted', category: 'workspace', title: '资源移交已接受' },
  { type: 'resource_transfer_declined', category: 'workspace', title: '资源移交已拒绝' },
  { type: 'topic_mentioned', category: 'mention', title: '话题评论中提及你' },
  { type: 'task_mentioned', category: 'mention', title: '任务评论中提及你' },
  { type: 'comment_removed', category: 'system', title: '你的评论已被移除' },
  { type: 'comment_restored', category: 'system', title: '你的评论已恢复' },
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENTS)[number]['type'];
export type DeliveryChannel = 'inbox' | 'email' | 'sms';
export const NOTIFICATION_CHANNELS: DeliveryChannel[] = ['inbox', 'email', 'sms'];
