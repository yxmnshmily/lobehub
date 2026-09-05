import {
  TravelProductionApiName,
  TravelProductionIdentifier,
} from '@lobechat/builtin-tool-travel-production';
import type { OperationToolDispatchPolicy } from '@lobechat/types';

export type TravelProductionIntent = 'copy' | 'image' | 'video' | 'document';

export interface TravelOrchestrationMember {
  clientId: string | null;
  enabled?: boolean;
  id: string;
}

export interface TravelOrchestrationInput {
  members: TravelOrchestrationMember[];
  message: string;
  /** Server-derived metadata only. Raw conversation or account data is not accepted. */
  previousTurn?: {
    confirmedIntents: readonly TravelProductionIntent[];
    taskStatus?: 'failed' | 'pending' | 'queued' | 'running' | 'succeeded' | 'unavailable';
  };
}

export const TRAVEL_SPECIALIST_UNAVAILABLE = {
  code: 'TRAVEL_SPECIALIST_UNAVAILABLE',
  message: '对应的旅游制作助理尚未配置，请先由管理员完成群成员配置。',
} as const;

type NonEmptyArray<Value> = [Value, ...Value[]];

const isNonEmpty = <Value>(values: Value[]): values is NonEmptyArray<Value> => values.length > 0;

const DOCUMENT_REQUEST_PATTERN = /(?:文档|文挡|行程单|方案书?|手册|报价单|word|pdf|docx|document)/i;
const CITED_CONTENT_PATTERN =
  /(?:引用(?:别人|他人)?的?(?:说法|内容)?|参考(?:内容)?|原文|原话)[:：](?:“[^”\n]{1,500}”|‘[^’\n]{1,500}’|《[^》\n]{1,500}》|【[^】\n]{1,500}】|"[^"\n]{1,500}"|'[^'\n]{1,500}')/g;
const ATTACHMENT_REFERENCE_PATTERN = /(?:附件|文件)名?[:：][^，,。；;\n]+/g;
const URL_PATTERN = /https?:\/\/[^，,。；;\n]+/gi;
const MARKDOWN_LINK_PATTERN = /!?\[[^\n]*\]\([^\n)]*\)/g;
const HTML_TAG_PATTERN = /<[^>\n]+>/g;
const EXCLUSIVE_REQUEST_PATTERN = /(?:只需要|仅需要|只需|仅需|只要|仅要|只)([^。；;\n]+)$/;
const DOUBLE_NEGATION_PATTERN = /不是不要|并非不要|不要不|不能不/g;
const CONTROL_OVERRIDE_PATTERN = /(?:model|provider|userId|groupId)[:=].*$/i;
const CONSULTATION_CUE_PATTERN =
  /咨询|价格|收费|计费|多少钱|多少|费用|教程|教学|灵感|思路|尺寸|怎么|如何|哪个|模型|推荐|能不能|是否|合理|够不够|下载|积分|多久|运营|平台|流量|数据|分析|看看|看短?视频|观看|播放|打开|查看|浏览|上传|仅供参考|只是参考|作为参考|(?:图片|文档)(?:链接|地址)|格式|清晰度|阅读|预览|分享|解析|页数|对比|price|pricing|cost|tutorial|idea/i;
const CONSULTATION_ONLY_PATTERN =
  /(?:只|仅)想?(?:咨询|了解|问问|询问|学习|查看|看看)|(?:咨询|了解|问问|询问|学习).*(?:不|不要|无需)(?:执行|生成|制作|产出)/;
const SENSITIVE_OR_PRIVILEGED_REQUEST_PATTERN =
  /(?:绕过|跳过|规避|关闭)(?:权限|认证|审核|计费|扣费|credits?|余额)|(?:用|使用|借用?|获取|提升|授予|冒充)(?:管理员|admin)(?:权限|身份)|(?:读取|查看|获取|导出)(?:其他|别的|任意)用户的?(?:信息|资料|数据|余额|身份证号?|银行卡号?|护照号?|手机号)|(?:model|provider|userId|groupId)[:=]/i;
const SENSITIVE_CONTENT_REQUEST_PATTERN =
  /(?:包含|写入|附上|加入|展示|列出)[^，,。；;\n]{0,80}(?:身份证号?|银行卡号?|护照号?|手机号|密码|密钥|令牌|api[ _-]?key|access[ _-]?token)/i;
const ASSIGNED_SENSITIVE_VALUE_PATTERN =
  /(?:身份证号?|id[_-]?card|护照号?|passport|银行卡号?|bank[_-]?card|支付密码|payment[_-]?(?:pin|password)|手机号|手机号码|联系电话|phone|邮箱|email|api[_-]?key|access[_-]?token|token)[:=：为](?:<[^>,，。；;\n]{2,80}>|\{[^},，。；;\n]{2,80}\}|\[[^\],，。；;\n]{2,80}\]|(?=[\w@.*+-]{4})(?=[\w@.*+-]*[\d@.*+-])[\w@.*+-]+)/i;
const LABELED_SENSITIVE_CODE_PATTERN =
  /(?:护照号?|passport)[A-Z]\d{7,9}|(?:银行卡号?|bank[_-]?card)\d(?:-?\d){12,18}|(?:支付密码|payment[_-]?(?:pin|password))\d{6}/i;
const EMAIL_VALUE_PATTERN = /[\w.%+-]{1,64}@[\w.-]{1,253}\.[a-z]{2,63}/i;
const MOBILE_VALUE_PATTERN = /(?:^|\D)1[3-9]\d-?\d{4}-?\d{4}(?:\D|$)/;
const CHINESE_ID_VALUE_PATTERN =
  /(?:^|\D)(?:1[1-5]|2[1-3]|3[1-7]|4[1-6]|5[0-4]|6[1-5]|71|8[12])\d{4}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dX](?:\D|$)/i;
const PASSPORT_VALUE_PATTERN = /(?:^|[^A-Z\d])[EG]\d{8}(?:[^A-Z\d]|$)/i;
const SECRET_VALUE_PATTERN = /sk-[\w-]{8,}|gh[pousr]_\w{8,}|bearer[\w.~-]{12,}/i;
const SENSITIVE_PLACEHOLDER_PATTERN =
  /[<{[](?:id[_-]?(?:card|number)|passport(?:_number)?|bank(?:_card)?|card[_-]?number|phone(?:_number)?|email(?:_address)?|api[_-]?key|access[_-]?token|token)[>}\]]/i;
const PAYMENT_CARD_CANDIDATE_PATTERN = /(?:^|\D)((?:\d-?){12,18}\d)(?:\D|$)/g;
const OTHER_PERSON_DATA_ARTIFACT_PATTERN =
  /(?:其他|任意|别的|他人的?)(?:游客|用户|客户)?(?:个人)?(?:资料|信息|联系方式|护照资料).{0,80}(?:写进|写入|加入|放进|展示)|(?:写进|写入|加入|放进|展示).{0,80}(?:其他|任意|别的|他人的?)(?:游客|用户|客户)?(?:个人)?(?:资料|信息|联系方式|护照资料)/;
const PRIVACY_INFORMATION_PATTERN =
  /(?:隐私|合规|脱敏|个人信息|个人资料|联系方式|邮箱|手机号|身份证|护照|银行卡|api[_-]?key|access[_-]?token|token).{0,40}(?:讨论|了解|咨询|是否|需要|要不要|应该|如何|怎么|哪些|有哪些|要求|准备|保存|收集)|(?:讨论|了解|咨询|是否|需要|要不要|应该|如何|怎么|哪些|有哪些).{0,40}(?:隐私|合规|脱敏|个人信息|个人资料|联系方式|邮箱|手机号|身份证|护照|银行卡|api[_-]?key|access[_-]?token|token)/i;
const ENGLISH_PRIVACY_INFORMATION_PATTERN =
  /(?:how|should|need|required?|optional|store|collect|field|privacy|compliance).{0,80}(?:passport(?:number)?|email|phone|personaldata|api[_-]?key|access[_-]?token|token)|(?:passport(?:number)?|email|phone|personaldata|api[_-]?key|access[_-]?token|token).{0,80}(?:how|should|need|required?|optional|store|collect|field|privacy|compliance)/i;
const GLOBAL_EXECUTION_DENIAL_PATTERN =
  /(?:禁止|严禁|不得|不要|不用|无需|别)(?:执行|调用)(?:任何|全部|所有)?(?:工具|操作|任务)?/;
const CAPABILITY_INFORMATION_PATTERN =
  /(?:能|可以|可)(?:帮我)?做什么|支持(?:什么|哪些)|有哪些(?:功能|能力)|能力说明/;
const TRAVEL_INFORMATION_CONTEXT_PATTERN =
  /旅游|旅行|景区|线路|路线|行程|攻略|团期|酒店|民宿|出发|目的地|预算|文案|宣传稿|口播|推文|标题|脚本|图文|图片|封面|海报|配图|头图|缩略图|视频|短片|成片|分镜|文档|方案书?|手册|报价单|word|pdf|docx|document|image|cover/i;
const NATURAL_TRAVEL_CONSULTATION_PATTERN =
  /(?:什么时候去(?:最|比较)?好|路况(?:好吗|怎么样|如何)|去[^ ，,。；;\n]{1,40}怎么走|去[^ ，,。；;\n]{1,40}(?:一周|[0-9一二三四五六七八九十]+天)[^\n]{0,40}(?:多少钱|预算|费用)|去[^ ，,。；;\n]{1,40}(?:冷不冷|热不热|天气)[^\n]{0,40}(?:带什么|穿什么|装备))/;
const DIRECT_PRODUCTION_PATTERN =
  /(?:改写|生成|制作|剪辑|剪成|整理成?|输出|导出|生图|作图|画图|[写做]|generate|create|write)(?:一[张段份条个篇])?(?:新|旅游|景区|宣传)?(?:文案|宣传稿|口播|推文|标题|脚本|攻略|图片|封面|海报|配图|头图|缩略图|短视频|视频|视屏|成片|分镜|短片|文档|文挡|行程单|方案书?|手册|报价单|image|cover|video|word|docx|document|pdf)/i;
const NEGATED_INTENT_PATTERN =
  /(?:不要|不用|不需要|无需|禁止|[别不])再?(?:生成|制作|做|剪辑|剪成|写|整理|修改|改(?:动|成)?|调整|编辑)?(?:一[张段份条个篇])?(?:文案|宣传稿|旁白稿|口播|推文|标题|脚本|攻略|图片|封面|海报|配图|头图|缩略图|生图|作图|画图|视频|视屏|成片|分镜|短片|文档|文挡|行程单|方案书?|手册|报价单)(?=[，,。；;\n]|$)/g;
const NEGATED_PRODUCTION_ACTION_PATTERN =
  /(?:不要|不用|不需要|无需|禁止|[别不])再?(?:生成|制作|做|出图)(?=[，,。；;\n]|$)/g;
const IMAGE_ANALYSIS_CONTEXT_PATTERN =
  /((?:分析|点评|评估|检查|看看)(?:一张|这张|那张|一幅|这幅|那幅)?)(?:图片|封面|海报|配图|头图|缩略图)(?=(?:但|并且|[并，,])?(?:不要|不用|不需要|无需|禁止|[别不])(?:生成|制作|做|出图))/g;
const IMAGE_AS_COPY_CONTEXT_PATTERN =
  /([给为](?:现有|已有|这张|那张)?)(?:图片|封面|海报|配图|头图|缩略图)(?=(?:改写|润色|优化|[写拟])(?:一[个段篇条])?(?:文案|标题|口播|推文|脚本|攻略))/g;
const IMAGE_TITLE_EDIT_CONTEXT_PATTERN =
  /((?:图片|封面|海报|配图|头图|缩略图)上?(?:加上?|添加|放上|换成)(?:一?[个条])?)标题/g;
const COPY_AS_DOCUMENT_SOURCE_PATTERN =
  /([把将](?:现有|已有|这段|那段)?)(?:文案|口播|推文|脚本|攻略)(?=(?:整理|排版|汇总|转换|转成|导出)[成为]?(?:word|pdf|docx|文档|行程单|方案|手册|报价单))/gi;
const ITINERARY_DOCUMENT_EDIT_CONTEXT_PATTERN =
  /([把将给]?(?:刚才|上面|之前|前面)?的?)行程(?=(?:补上?|增加|加上?)(?:预算|费用)|(?:导出|整理成|转成|改成)(?:word|pdf|表格))/gi;
const DOCUMENT_AS_COPY_SOURCE_PATTERN =
  /([把将][这那]?[份个]?)(?:word|pdf|docx|行程文档|文档|行程单|方案|手册|报价单)(?=(?:改写|重写|润色|转换|转成|整理)[成为]?(?:小红书|抖音|宣传)?(?:文案|标题|口播|推文|脚本|攻略))/gi;
const IMAGE_AS_VIDEO_SOURCE_PATTERN =
  /([把将][这那]?[张幅]?)(?:图片|封面|海报|配图|头图|缩略图)(?:素材)?(?=(?:剪辑|剪成|制作成|转成)视频)/g;
const VIDEO_AS_COPY_CONTEXT_PATTERN =
  /(?:短视频|视频|视屏|短片|成片)(?:分镜)?(?=写?(?:拍摄)?(?:口播)?(?:脚本|文案)|拟(?:一[个条组]|[一二三四五六七八九十]+个)?标题|旁白稿)/g;
const VIDEO_CHANNEL_CONTEXT_PATTERN = /短?视频(?=号|平台)/g;
const COPY_AS_VIDEO_CONTEXT_PATTERN = /口播片/g;
const CONTEXTUAL_FOLLOW_UP_PATTERN =
  /^请?(?:继续(?:一下)?|接着[来做改](?:一下)?|再[来做改](?:一版|一次|一下)|重新[来做改](?:一版|一次|一下)|改短一点|改长一点|换个风格|优化一下|调整一下|完善一下)[吧呢啊呀。！!？?]*$/;
const CONTEXTUAL_FOLLOW_UP_NEGATION_PATTERN = /不要|不用|不需要|无需|禁止|别|停止|取消|不再|算了/;
const MAX_CONTEXTUAL_FOLLOW_UP_LENGTH = 512;
const TRUSTED_PREVIOUS_TURN_KEYS = new Set(['confirmedIntents', 'taskStatus']);
const TRUSTED_PREVIOUS_TASK_STATUSES = new Set([
  'failed',
  'pending',
  'queued',
  'running',
  'succeeded',
  'unavailable',
]);

export type TravelRoutingResult =
  | {
      intents: NonEmptyArray<TravelProductionIntent>;
      memberIds: NonEmptyArray<string>;
      mode: 'delegate';
    }
  | {
      intents: [];
      memberIds: [];
      mode: 'supervisor-fallback';
      reason: 'policy-denied' | 'safe-informational' | 'unknown-intent';
    }
  | {
      error: typeof TRAVEL_SPECIALIST_UNAVAILABLE;
      intents: NonEmptyArray<TravelProductionIntent>;
      memberIds: [];
      mode: 'unavailable';
    };

const INTENT_RULES: ReadonlyArray<{
  clientId: string;
  intent: TravelProductionIntent;
  productionApiName?: (typeof TravelProductionApiName)[keyof typeof TravelProductionApiName];
  requestPattern: RegExp;
}> = [
  {
    clientId: 'default-travel-copywriter',
    intent: 'copy',
    productionApiName: TravelProductionApiName.generateCopy,
    requestPattern: /(?:文案|宣传稿|旁白稿|口播|推文|标题|脚本|攻略|copywriting)/i,
  },
  {
    clientId: 'default-travel-image-designer',
    intent: 'image',
    productionApiName: TravelProductionApiName.generateImage,
    requestPattern: /(?:图片|封面|海报|配图|头图|缩略图|出图|生图|作图|画图|image|cover)/i,
  },
  {
    clientId: 'default-travel-video-producer',
    intent: 'video',
    productionApiName: TravelProductionApiName.generateVideo,
    requestPattern: /(?:视频|视屏|剪辑|剪成|成片|分镜|口播片|短片|video)/i,
  },
  {
    clientId: 'default-travel-document-assistant',
    intent: 'document',
    productionApiName: TravelProductionApiName.generateDocument,
    requestPattern: DOCUMENT_REQUEST_PATTERN,
  },
];

const DOCUMENT_TITLE_PATTERN =
  /标题\s*(?:设为|[为是叫:：])\s*(?:[“"'‘《【]([^”"'’》】\n]{1,120})[”"'’》】]|([^，,。；;\n]{1,120}))/;
const DOCUMENT_TITLE_METADATA_PATTERN =
  /标题\s*(?:设为|[为是叫:：])\s*(?:[“"'‘《【][^”"'’》】\n]{1,120}[”"'’》】]|[^，,。；;\n]{1,120})/g;

const extractDocumentTitle = (message: string) => {
  const match = message.match(DOCUMENT_TITLE_PATTERN);
  return (match?.[1] || match?.[2])?.trim();
};

const stripDocumentTitleMetadata = (message: string) =>
  message.replaceAll(DOCUMENT_TITLE_METADATA_PATTERN, '');

const stripDelimitedSections = (message: string, opening: string, closing: string) => {
  let cursor = 0;
  let result = '';

  while (cursor < message.length) {
    const start = message.indexOf(opening, cursor);
    if (start === -1) return result + message.slice(cursor);

    result += message.slice(cursor, start);
    const end = message.indexOf(closing, start + opening.length);
    if (end === -1) return result;
    cursor = end + closing.length;
  }

  return result;
};

const stripHtmlElement = (message: string, tagName: string) => {
  const normalizedMessage = message.toLowerCase();
  const opening = `<${tagName}`;
  const closing = `</${tagName}>`;
  let cursor = 0;
  let result = '';

  while (cursor < message.length) {
    const start = normalizedMessage.indexOf(opening, cursor);
    if (start === -1) return result + message.slice(cursor);

    result += message.slice(cursor, start);
    const openingEnd = normalizedMessage.indexOf('>', start + opening.length);
    if (openingEnd === -1) return result;
    const end = normalizedMessage.indexOf(closing, openingEnd + 1);
    if (end === -1) return result;
    cursor = end + closing.length;
  }

  return result;
};

const stripJsonObjects = (message: string) => {
  let cursor = 0;
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  let result = '';

  for (let index = 0; index < message.length; index++) {
    const character = message[index];
    if (depth === 0) {
      if (character === '{') {
        result += message.slice(cursor, index);
        depth = 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) cursor = index + 1;
  }

  return depth === 0 ? result + message.slice(cursor) : result;
};

const stripNonInstructionMarkup = (message: string) => {
  const withoutCode = stripDelimitedSections(message, '```', '```');
  const withoutComments = stripDelimitedSections(withoutCode, '<!--', '-->');
  const withoutScripts = stripHtmlElement(withoutComments, 'script');
  const withoutStyles = stripHtmlElement(withoutScripts, 'style');
  const withoutSystem = stripHtmlElement(withoutStyles, 'system');
  const withoutAssistant = stripHtmlElement(withoutSystem, 'assistant');

  return stripJsonObjects(withoutAssistant)
    .replaceAll(MARKDOWN_LINK_PATTERN, '')
    .replaceAll(HTML_TAG_PATTERN, '');
};

const stripUnicodeControls = (message: string) => {
  const visibleCharacters: string[] = [];

  for (const character of message) {
    const codePoint = character.codePointAt(0) || 0;
    const isHiddenControl =
      codePoint <= 0x08 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2060 && codePoint <= 0x206f) ||
      codePoint === 0xfeff;
    if (!isHiddenControl) visibleCharacters.push(character);
  }

  return visibleCharacters.join('');
};

const compactRoutingMessage = (message: string) => {
  const normalizedMessage = stripUnicodeControls(message.normalize('NFKC'));
  return stripNonInstructionMarkup(normalizedMessage)
    .replaceAll(/[\r\n]+/g, '，')
    .replaceAll(/\s+/g, '');
};

const compactPolicyMessage = (message: string) =>
  stripUnicodeControls(message.normalize('NFKC')).replaceAll(/\s+/g, '');

const containsPaymentCardValue = (compactMessage: string) => {
  for (const match of compactMessage.matchAll(PAYMENT_CARD_CANDIDATE_PATTERN)) {
    const digits = match[1].replaceAll('-', '');
    if (!/^(?:3[47]|4|5[1-5]|62)/.test(digits) || digits.length < 13 || digits.length > 19) {
      continue;
    }

    let sum = 0;
    const parity = digits.length % 2;
    for (let index = 0; index < digits.length; index++) {
      let digit = Number(digits[index]);
      if (index % 2 === parity && (digit *= 2) > 9) digit -= 9;
      sum += digit;
    }
    if (sum % 10 === 0) return true;
  }

  return false;
};

const isPolicyDeniedMessage = (compactMessage: string) =>
  SENSITIVE_OR_PRIVILEGED_REQUEST_PATTERN.test(compactMessage) ||
  SENSITIVE_CONTENT_REQUEST_PATTERN.test(compactMessage) ||
  ASSIGNED_SENSITIVE_VALUE_PATTERN.test(compactMessage) ||
  LABELED_SENSITIVE_CODE_PATTERN.test(compactMessage) ||
  EMAIL_VALUE_PATTERN.test(compactMessage) ||
  MOBILE_VALUE_PATTERN.test(compactMessage) ||
  CHINESE_ID_VALUE_PATTERN.test(compactMessage) ||
  PASSPORT_VALUE_PATTERN.test(compactMessage) ||
  SECRET_VALUE_PATTERN.test(compactMessage) ||
  SENSITIVE_PLACEHOLDER_PATTERN.test(compactMessage) ||
  containsPaymentCardValue(compactMessage) ||
  OTHER_PERSON_DATA_ARTIFACT_PATTERN.test(compactMessage) ||
  (GLOBAL_EXECUTION_DENIAL_PATTERN.test(compactMessage) &&
    !CONSULTATION_ONLY_PATTERN.test(compactMessage));

const isSafeInformationalMessage = (compactMessage: string) =>
  PRIVACY_INFORMATION_PATTERN.test(compactMessage) ||
  ENGLISH_PRIVACY_INFORMATION_PATTERN.test(compactMessage) ||
  NATURAL_TRAVEL_CONSULTATION_PATTERN.test(compactMessage) ||
  (TRAVEL_INFORMATION_CONTEXT_PATTERN.test(compactMessage) &&
    (CONSULTATION_ONLY_PATTERN.test(compactMessage) ||
      CONSULTATION_CUE_PATTERN.test(compactMessage) ||
      CAPABILITY_INFORMATION_PATTERN.test(compactMessage)));

const normalizeRoutingMessage = (message: string) => {
  const compactMessage = compactRoutingMessage(message);
  if (
    isPolicyDeniedMessage(compactPolicyMessage(message)) ||
    CONSULTATION_ONLY_PATTERN.test(compactMessage) ||
    PRIVACY_INFORMATION_PATTERN.test(compactMessage) ||
    ENGLISH_PRIVACY_INFORMATION_PATTERN.test(compactMessage)
  ) {
    return '';
  }

  const withoutReferences = compactMessage
    .replaceAll(CITED_CONTENT_PATTERN, '')
    .replaceAll(ATTACHMENT_REFERENCE_PATTERN, '')
    .replaceAll(URL_PATTERN, '')
    .replace(CONTROL_OVERRIDE_PATTERN, '');
  const affirmativeRequest = withoutReferences.replaceAll(DOUBLE_NEGATION_PATTERN, '');
  const exclusiveRequest = affirmativeRequest.match(EXCLUSIVE_REQUEST_PATTERN)?.[1];
  const activeRequest = exclusiveRequest?.trim() || affirmativeRequest;
  const positiveProductionRequest = activeRequest
    .replaceAll(NEGATED_INTENT_PATTERN, '')
    .replaceAll(NEGATED_PRODUCTION_ACTION_PATTERN, '');
  if (
    CONSULTATION_CUE_PATTERN.test(activeRequest) &&
    !DIRECT_PRODUCTION_PATTERN.test(positiveProductionRequest)
  ) {
    return '';
  }
  const contextualRequest = activeRequest
    .replaceAll(IMAGE_ANALYSIS_CONTEXT_PATTERN, '$1素材')
    .replaceAll(IMAGE_TITLE_EDIT_CONTEXT_PATTERN, '$1文字')
    .replaceAll(VIDEO_CHANNEL_CONTEXT_PATTERN, '内容')
    .replaceAll(COPY_AS_VIDEO_CONTEXT_PATTERN, '视频')
    .replaceAll(VIDEO_AS_COPY_CONTEXT_PATTERN, '素材')
    .replaceAll(DOCUMENT_AS_COPY_SOURCE_PATTERN, '$1素材')
    .replaceAll(ITINERARY_DOCUMENT_EDIT_CONTEXT_PATTERN, '$1文档')
    .replaceAll(IMAGE_AS_VIDEO_SOURCE_PATTERN, '$1素材')
    .replaceAll(NEGATED_INTENT_PATTERN, '')
    .replaceAll(NEGATED_PRODUCTION_ACTION_PATTERN, '')
    .replaceAll(IMAGE_AS_COPY_CONTEXT_PATTERN, '$1素材')
    .replaceAll(COPY_AS_DOCUMENT_SOURCE_PATTERN, '$1素材');

  return DOCUMENT_REQUEST_PATTERN.test(contextualRequest)
    ? stripDocumentTitleMetadata(contextualRequest)
    : contextualRequest;
};

const isContextualFollowUp = (message: string) => {
  if (!message || message.length > MAX_CONTEXTUAL_FOLLOW_UP_LENGTH) return false;

  const normalizedMessage = stripUnicodeControls(message.normalize('NFKC'));
  const compactMessage = stripNonInstructionMarkup(normalizedMessage).replaceAll(/\s+/g, '');
  if (
    !compactMessage ||
    CONTEXTUAL_FOLLOW_UP_NEGATION_PATTERN.test(compactMessage) ||
    CONSULTATION_CUE_PATTERN.test(compactMessage)
  ) {
    return false;
  }

  return CONTEXTUAL_FOLLOW_UP_PATTERN.test(compactMessage);
};

const resolveTrustedPreviousIntentRules = (
  previousTurn: TravelOrchestrationInput['previousTurn'],
) => {
  if (previousTurn === undefined) return { denied: false, rules: [] };
  if (!previousTurn || typeof previousTurn !== 'object' || Array.isArray(previousTurn)) {
    return { denied: true, rules: [] };
  }
  if (Object.keys(previousTurn).some((key) => !TRUSTED_PREVIOUS_TURN_KEYS.has(key))) {
    return { denied: true, rules: [] };
  }
  if (
    previousTurn.taskStatus !== undefined &&
    !TRUSTED_PREVIOUS_TASK_STATUSES.has(previousTurn.taskStatus)
  ) {
    return { denied: true, rules: [] };
  }
  if (!Array.isArray(previousTurn.confirmedIntents) || previousTurn.confirmedIntents.length === 0) {
    return { denied: true, rules: [] };
  }
  const confirmedIntents = new Set(previousTurn.confirmedIntents);
  if (
    confirmedIntents.size === 0 ||
    [...confirmedIntents].some(
      (intent) => !INTENT_RULES.some((candidate) => candidate.intent === intent),
    )
  ) {
    return { denied: true, rules: [] };
  }

  return {
    denied: false,
    rules: INTENT_RULES.filter(({ intent }) => confirmedIntents.has(intent)),
  };
};

export const routeTravelRequest = ({
  members,
  message,
  previousTurn,
}: TravelOrchestrationInput): TravelRoutingResult => {
  const compactMessage = compactRoutingMessage(message);
  const policyMessage = compactPolicyMessage(message);
  const routingMessage = normalizeRoutingMessage(message);
  const explicitRules = INTENT_RULES.filter(({ requestPattern }) =>
    requestPattern.test(routingMessage),
  );
  const contextualFollowUp = explicitRules.length === 0 && isContextualFollowUp(message);
  const previousIntentResolution = contextualFollowUp
    ? resolveTrustedPreviousIntentRules(previousTurn)
    : { denied: false, rules: [] };
  const matchedRules = explicitRules.length > 0 ? explicitRules : previousIntentResolution.rules;
  const intents = matchedRules.map(({ intent }) => intent);
  if (!isNonEmpty(intents)) {
    const reason =
      isPolicyDeniedMessage(policyMessage) || previousIntentResolution.denied
        ? 'policy-denied'
        : isSafeInformationalMessage(compactMessage)
          ? 'safe-informational'
          : 'unknown-intent';
    return { intents: [], memberIds: [], mode: 'supervisor-fallback', reason };
  }

  const matches = matchedRules.map(({ clientId, intent }) => ({
    intent,
    member: members.find((member) => member.clientId === clientId && member.enabled !== false),
  }));
  if (!isNonEmpty(matches) || matches.some(({ member }) => !member)) {
    return { error: TRAVEL_SPECIALIST_UNAVAILABLE, intents, memberIds: [], mode: 'unavailable' };
  }

  const memberIds = [...new Set(matches.flatMap(({ member }) => (member ? [member.id] : [])))];
  if (!isNonEmpty(memberIds)) {
    return { error: TRAVEL_SPECIALIST_UNAVAILABLE, intents, memberIds: [], mode: 'unavailable' };
  }

  return {
    intents,
    memberIds,
    mode: 'delegate',
  };
};

type TravelRouteByMode<Mode extends TravelRoutingResult['mode']> = Extract<
  TravelRoutingResult,
  { mode: Mode }
>;

export type TravelToolDispatchResult =
  | {
      mode: 'delegate';
      policy: OperationToolDispatchPolicy;
      route: TravelRouteByMode<'delegate'>;
    }
  | {
      mode: 'supervisor-fallback';
      route: TravelRouteByMode<'supervisor-fallback'>;
    }
  | {
      error: typeof TRAVEL_SPECIALIST_UNAVAILABLE;
      mode: 'unavailable';
      route: TravelRouteByMode<'unavailable'>;
    };

/** Translate private travel routing into the AgentRuntime's generic deterministic tool policy. */
export const createTravelToolDispatchPolicy = (
  input: TravelOrchestrationInput,
): TravelToolDispatchResult => {
  const route = routeTravelRequest(input);
  if (route.mode === 'unavailable') return { error: route.error, mode: route.mode, route };
  if (route.mode === 'supervisor-fallback') return { mode: route.mode, route };

  return {
    mode: 'delegate',
    policy: {
      cursor: 0,
      finishAfterSteps: true,
      steps: route.memberIds.map((agentId) => {
        const member = input.members.find((candidate) => candidate.id === agentId);
        const productionApiName = INTENT_RULES.find(
          ({ clientId }) => clientId === member?.clientId,
        )?.productionApiName;
        const documentTitle =
          productionApiName === TravelProductionApiName.generateDocument
            ? extractDocumentTitle(input.message)
            : undefined;
        const memberPolicy: OperationToolDispatchPolicy = productionApiName
          ? {
              cursor: 0,
              finishAfterSteps: true,
              steps: [
                {
                  apiName: productionApiName,
                  arguments: JSON.stringify({
                    prompt: input.message,
                    ...(documentTitle && { title: documentTitle }),
                  }),
                  identifier: TravelProductionIdentifier,
                  toolName: `${TravelProductionIdentifier}____${productionApiName}`,
                },
              ],
              version: 1,
            }
          : { cursor: 0, finishAfterSteps: true, steps: [], version: 1 };

        return {
          apiName: 'speak',
          arguments: JSON.stringify({
            agentId,
            instruction: input.message,
            skipCallSupervisor: false,
          }),
          identifier: 'lobe-group-management',
          memberToolDispatchPolicies: { [agentId]: memberPolicy },
          toolName: 'lobe-group-management____speak',
        };
      }),
      version: 1,
    },
    route,
  };
};
