/**
 * Conservative boundary for the travel group's automatic topic archive.
 * Only explicit new requests start an archive; short answers/edits/retries stay
 * together. This is intentionally not a general-purpose semantic classifier.
 */
export const isIndependentGroupRequest = (prompt: string): boolean => {
  const text = prompt.trim().replaceAll(/\s+/g, ' ');
  if (
    /^(?:请|麻烦)?\s*(?:继续|接着|重试|重新|修复后|最终验收|修改|调整|优化|完善|改|换|再来|再做)/.test(
      text,
    )
  )
    return false;
  if (/^(?:请|麻烦)?\s*(?:把|将).{0,80}(?:改|换|调整|优化|修改)/.test(text)) return false;
  // Quoted/reference content must not turn a question into a new production request.
  if (/^(?:为什么|怎么|如何|什么|请问|不要|不用|取消|停止)/.test(text)) return false;
  return text
    .split(/[，,。；;\n]/)
    .some((clause) =>
      /^(?:请|麻烦)?\s*(?:(?:帮我|给我|为我)\s*)?(?:规划|安排|设计|生成|制作|[写做画]|整理|输出|出\s*一?[个份段张条篇])/.test(
        clause.trim(),
      ),
    );
};
