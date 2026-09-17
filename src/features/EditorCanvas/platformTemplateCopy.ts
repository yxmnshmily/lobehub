// Exact platform-authored paragraphs; do not translate arbitrary English prose.
export const platformTemplateCopy: Record<string, string> = {
  'Execute only the Current Task contract. Do not implement, validate, or pre-empt any sibling or downstream Task node, even when the overall goal context describes it.':
    '只执行当前任务的要求。即使总目标提到了其他任务，也不要提前实施、检查或代办并行任务及后续任务。',
  'The complete requirements for this Task are included here. Do not inspect unrelated agent documents to recover requirements. This Task carries its own Acceptance: run it inside this Task — drive the real product surface, capture the evidence, and submit it against your own criteria while you work. Submit evidence only; an independent verifier judges whether this Task is complete.':
    '本任务的完整要求已列在这里，不要从无关成员的文档中寻找补充要求。本任务单独验收：请实际操作产品、收集证据，并按本任务的标准提交。执行者只提交证据，由独立检查者判断是否完成。',
  'For a Task that owns implementation, missing or broken capabilities within its scope are work to implement or repair, not a reason to stop at a capability report or ask the user for a finished implementation. Establish the runnable environment needed to exercise your changes, within the authorized scope. After failed verification, use the feedback to change the implementation or resolve the prerequisite before repeating the same checks; report a blocker only when progress requires unavailable external access, a user decision, or work outside this Task.':
    '如果任务包含开发，范围内缺少或损坏的功能需要实现或修复，不能只报告做不到，也不能要求用户提供现成实现。请在授权范围内准备可运行的环境。验收失败后，应根据反馈修改实现或解决前置问题，再重新检查。只有缺少外部访问权限、需要用户决定，或工作超出本任务范围时，才报告阻碍。',
  'For an investigation-only Task, deliver supported findings, gaps, and actionable next steps; do not silently expand into implementation. For a verification-only Task, report missing behavior honestly and identify the prerequisite or implementation work needed. Never claim a working product from a report or weaken the Current Task pass conditions to make it pass.':
    '如果任务仅要求调查，请提交有依据的结果、尚缺的信息和可执行的下一步，不要自行扩展到开发。如果仅要求检查，请如实说明缺失的功能和需要先完成的工作。不能把报告当作已运行的产品，也不能降低当前任务的完成标准。',
  'Create implementation-level subtasks when useful. Finish the operation once the Current Task deliverable and its concrete evidence are ready; Acceptance verification will decide whether this Task is complete.':
    '需要时可以拆分开发子任务。当前任务的成果和实际证据准备好后即可结束执行，再由验收检查决定是否完成。',
  'Make the final delivery self-contained for an independent verifier that may not have workspace access. Include the relevant artifact contents or exact excerpts and the raw outputs of decisive verification commands; file paths and claims that checks passed are not sufficient evidence by themselves.':
    '最终提交的内容应便于没有工作区访问权限的独立检查者核对。请附上相关成果内容或准确摘录，以及关键检查命令的原始输出；只有文件路径或“检查通过”的说法不够。',
  'Persist every deliverable inside the product, not only on the local disk. Write reports and analyses as agent documents, and produce generated files (pptx / xlsx / docx / pdf, …) in the operation workspace so they are uploaded and registered. A local path such as /tmp or a repository directory is a working location, not a delivery — anything left only there is unreviewable and is not attached to the Goal.':
    '所有成果都要保存到产品中，不能只留在本地磁盘。报告和分析保存为成员文档；生成的文件（PPTX、XLSX、DOCX、PDF 等）放在任务工作区中，以便上传和登记。本地临时目录或代码目录只是工作位置，留在其中的文件无法作为可查看的成果关联到目标。',
  'Return the produced artifacts, evidence, key findings, and the recommended next action. Do not mark the overall Goal complete.':
    '提交生成的成果、证据、主要结果和建议的下一步。不要把整个目标标记为完成。',
  'Pass only when the current Task deliverable is complete and supported by concrete evidence. Ignore sibling and downstream Task deliverables; they are verified by their own acceptance runs.':
    '只有当前任务的成果完整，并有实际证据支持，才算通过。其他并行任务和后续任务的成果由各自的验收流程检查，不计入本次验收。',
  'Inspect and reuse existing Goal findings, artifacts, metrics, and command results as the primary evidence. Do not repeat expensive or destructive work when the existing evidence is sufficient and still auditable.':
    '优先查看并复用目标已有的结果说明、成果文件、统计数据和命令输出作为证据。如果现有证据足够且仍可核对，不要重复执行耗费较大或会删除、覆盖数据的操作。',
  'Explicitly close every remaining acceptance gap instead of treating completed upstream Tasks as proof that the whole Goal is achieved. Run only the missing or stale checks needed to close those gaps.':
    '逐项补齐尚未满足的完成标准，不能把前面的任务已完成当作整个目标已达成的证明。只补做缺失或已失效的检查。',
  'Return one auditable final delivery with evidence for every requirement. If a requirement cannot be satisfied, state the exact gap and the minimum next action; do not claim the Goal is complete.':
    '提交一份可以核对的最终成果，为每项要求附上证据。如果某项要求无法满足，应明确说明差距和最少需要补做的工作，不能宣称目标已完成。',
  'PASS only when concrete evidence proves that every clause of the terminal Goal acceptance requirement is satisfied.':
    '只有实际证据证明总目标完成标准的每一项均已满足，才可以判定通过。',
  'An accurate gap analysis, a report that the Goal is not accepted, a suggested next action, or partial progress is NOT a passing delivery. Reject it so automatic recovery can continue or open a Gate.':
    '准确说明差距、报告尚未验收通过、建议下一步或只完成部分工作，都不算交付通过。应判定未通过，以便自动继续修复或进入待确认步骤。',
  'If any required count, field, evidence quality, or other explicit threshold is missing, the verdict MUST be failed even when the builder correctly identified and documented the gap.':
    '只要要求的数量、字段、证据质量或其他明确标准有任何一项不满足，即使执行者已正确说明并记录差距，也必须判定未通过。',
  'Complete full Goal acceptance': '完成目标整体验收',
  'Complete and prove the overall Goal acceptance requirement:':
    '完成总目标的全部要求，并提供证据：',
  'Terminal Goal acceptance requirement (authoritative):': '总目标完成标准（以此为准）：',
  'Required delivery:': '需要提交的成果：',
  'Main Agent verification handoff (context only, not acceptance criteria):':
    '主成员提交的验收说明（仅供参考，不作为完成标准）：',
  'Independently check these notes against the evidence. They do not amend the authoritative Goal requirement or establish that it passed.':
    '请根据证据独立核对这些说明。这些说明不改变总目标的完成标准，也不代表已经通过验收。',
};
