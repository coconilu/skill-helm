import fs from "node:fs";
import path from "node:path";
import { NAME_RE, readSkillInfo } from "./skills";
import type { LintIssue } from "./types";

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
  return issues;
}
