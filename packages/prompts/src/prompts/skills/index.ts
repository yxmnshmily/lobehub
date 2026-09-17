import { escapeXmlAttr, escapeXmlContent } from '../search/xmlEscape';

export { buildResourcesTreeText, resourcesTreePrompt } from './resourcesTree';

export type SkillSource = 'builtin' | 'device' | 'project' | 'user';

export interface SkillItem {
  description: string;
  identifier: string;
  location?: string;
  name: string;
  /**
   * Where the skill comes from. `project` and `device` skills live on the
   * execution device filesystem and `location` carries their absolute path so
   * the model can load them via the readFile tool.
   */
  source?: SkillSource;
}

export const skillPrompt = (skill: SkillItem) => {
  const attrs = [
    `name="${escapeXmlAttr(skill.name)}"`,
    `identifier="${escapeXmlAttr(skill.identifier)}"`,
  ];
  if (skill.source) attrs.push(`source="${escapeXmlAttr(skill.source)}"`);
  if (skill.location) attrs.push(`location="${escapeXmlAttr(skill.location)}"`);
  return `  <skill ${attrs.join(' ')}>${escapeXmlContent(skill.description)}</skill>`;
};

export const skillsPrompts = (skills: SkillItem[]) => {
  if (skills.length === 0) return '';

  const skillTags = skills.map((skill) => skillPrompt(skill)).join('\n');

  const hasFilesystemSkill = skills.some(
    (skill) => skill.source === 'project' || skill.source === 'device',
  );
  const filesystemHint = hasFilesystemSkill
    ? `\nFor a skill with source="project" or source="device", load it by calling the readFile tool on its \`location\` path before following its instructions.`
    : '';

  return `<available_skills>
${skillTags}
</available_skills>

Use activateSkill with a listed skill's exact name to load its instructions before applying it. When the user requests Skill-based work, load a relevant available skill unless its full instructions are already in the current context; a name or description is not the skill body.${filesystemHint}`;
};
