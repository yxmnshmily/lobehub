/** Safe deletion errors shared by the administrator API and its UI. */
export const USER_DELETION_ERRORS = {
  budget:
    '删除未完成：存在尚未关闭的计费预算。账号已停用，请检查对应任务和结算状态；不继续删除可恢复用户。',
  cleanup:
    '删除未完成：数据清理失败，账号已停用。请检查服务端错误记录后重试；不继续删除可恢复用户。',
  sessions: '删除未完成：账号已停用，但登录会话清理失败。请重试；不继续删除可恢复用户。',
  transfer:
    '删除未完成：存在尚未完成的成员转移。账号已停用，请处理转移任务后重试；不继续删除可恢复用户。',
};
