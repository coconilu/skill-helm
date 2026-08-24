import fs from "node:fs";
import path from "node:path";
import { parseSkillMd, serializeSkillMd } from "./frontmatter";
import { skillDir } from "./store";

export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function assertValidName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(`非法 Skill 名 "${name}"：须为小写字母/数字，单词间用连字符（如 video-summary）`);
  }
}

/** 读取 Skill 目录的 frontmatter 信息；缺 SKILL.md 时返回 null。 */
export function readSkillInfo(dir: string): { name: string; description: string } | null {
  const file = path.join(dir, "SKILL.md");
  if (!fs.existsSync(file)) return null;
  const { data } = parseSkillMd(fs.readFileSync(file, "utf8"));
  return {
    name: typeof data.name === "string" ? data.name : "",
    description: typeof data.description === "string" ? data.description : "",
  };
}

export function skillTemplate(name: string, description: string): string {
  const body = [
    `# ${name}`,
    "",
    "## 何时使用",
    "",
    "<在此补充触发场景，与 description 保持一致>",
    "",
    "## 使用方式",
    "",
    "<步骤、命令或约束>",
  ].join("\n");
  return serializeSkillMd({ name, description }, body);
}

/** 在库存中创建 Skill 包（模板按概念注册表约定生成）。 */
export function createSkillPackage(name: string, description: string): string {
  assertValidName(name);
  if (!description.trim()) throw new Error("description 不能为空：Agent 靠它发现 Skill");
  const dir = skillDir(name);
  if (fs.existsSync(dir)) throw new Error(`库存中已存在 Skill: ${name}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), skillTemplate(name, description.trim()), "utf8");
  return dir;
}
