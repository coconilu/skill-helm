import yaml from "js-yaml";

export interface Frontmatter {
  name?: string;
  description?: string;
  [key: string]: unknown;
}

/** 解析 SKILL.md 的 YAML frontmatter；没有 frontmatter 时返回空 data。 */
export function parseSkillMd(content: string): { data: Frontmatter; body: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: content };
  const data = (yaml.load(m[1]) as Frontmatter | undefined) ?? {};
  return { data, body: m[2] };
}

export function serializeSkillMd(data: Frontmatter, body: string): string {
  const head = yaml.dump(data, { lineWidth: 120 }).trim();
  return `---\n${head}\n---\n\n${body.replace(/\n+$/g, "")}\n`;
}
