import { type BuiltinSkillManifest } from '@lobechat/types';
import { type TFunction } from 'i18next';

type Translate = TFunction<'setting'>;

const stripOuterGuideTag = (content: string) => {
  const trimmedContent = content.trim();
  const openingTag = trimmedContent.match(/^<([A-Za-z][\w.-]*_guides)>/);

  if (!openingTag) return content;

  const closingTag = `</${openingTag[1]}>`;

  if (!trimmedContent.endsWith(closingTag)) return content;

  return trimmedContent.slice(openingTag[0].length, -closingTag.length).trim();
};

export const getLocalizedBuiltinSkillDetail = (
  builtinSkill: (BuiltinSkillManifest & { content?: string }) | undefined,
  identifier: string,
  t: Translate,
) => {
  if (!builtinSkill) {
    return { description: undefined, title: identifier };
  }

  return {
    content: builtinSkill.content
      ? stripOuterGuideTag(
          t(`tools.builtins.${builtinSkill.identifier}.content`, {
            defaultValue: builtinSkill.content,
          }),
        )
      : undefined,
    description: builtinSkill.description
      ? t(`tools.builtins.${builtinSkill.identifier}.description`, {
          defaultValue: builtinSkill.description,
        })
      : undefined,
    title: t(`tools.builtins.${builtinSkill.identifier}.title`, {
      defaultValue: builtinSkill.name,
    }),
  };
};

export const getNoPermissionsTitle = (identifier: string, type: string, t: Translate) => {
  if (type !== 'builtin') return identifier;

  return t(`tools.builtins.${identifier}.title`, { defaultValue: identifier });
};
