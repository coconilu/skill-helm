import fs from "node:fs";
import path from "node:path";
import { parseSkillMd } from "./frontmatter";
import { NAME_RE, readSkillInfo } from "./skills";
import type { LintIssue } from "./types";

const MAX_SKILL_MD_LINES = 500;

/** 按概念注册表约定校验 Skill 目录。 */
export function lintDir(dir: string, expectedName?: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const name = expectedName ?? path.basename(dir);
  if (!NAME_RE.test(name)) {
    issues.push({ level: "error", rule: "naming", message: `目录名 "${name}" 不符合命名规范（小写字母/数字 + 连字符）` });
  }
  const file = path.join(dir, "SKILL.md");
  if (!fs.existsSync(file)) {
    issues.push({ level: "error", rule: "anatomy", message: "缺少 SKILL.md" });
    return issues;
  }
  const content = fs.readFileSync(file, "utf8");
  const info = readSkillInfo(dir)!;
  if (!info.name) {
    issues.push({ level: "error", rule: "frontmatter", message: "frontmatter 缺少 name" });
  } else if (info.name !== name) {
    issues.push({ level: "warning", rule: "frontmatter", message: `frontmatter name "${info.name}" 与目录名 "${name}" 不一致` });
  }
  if (!info.description) {
    issues.push({ level: "error", rule: "frontmatter", message: "frontmatter 缺少 description" });
  } else {
    if (info.description.length < 10) {
      issues.push({ level: "warning", rule: "description", message: "description 过短，Agent 难以判断触发时机" });
    }
    if (info.description.length > 1024) {
      issues.push({ level: "warning", rule: "description", message: "description 超过 1024 字符" });
    }
  }

  const { body } = parseSkillMd(content);
  const trimmed = body.trim();
  if (trimmed.length < 50) {
    issues.push({ level: "warning", rule: "body", message: "正文过短：建议补充「何时使用」「使用方式」" });
  } else if (!/^#{1,3}\s/m.test(trimmed)) {
    issues.push({ level: "warning", rule: "body", message: "正文没有章节标题，结构不清晰" });
  }
  const lineCount = content.split(/\r?\n/).length;
  if (lineCount > MAX_SKILL_MD_LINES) {
    issues.push({ level: "warning", rule: "body", message: `SKILL.md 超过 ${MAX_SKILL_MD_LINES} 行，细节建议移到 references/ 按需加载` });
  }
  return issues;
}
