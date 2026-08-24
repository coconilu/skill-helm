import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanSkillsInRepo } from "../src";
import { setupTestEnv, writeSkill, type TestEnv } from "./helpers";

let env: TestEnv;
beforeEach(() => {
  env = setupTestEnv();
});
afterEach(() => env.cleanup());

describe("market.scanSkillsInRepo", () => {
  it("发现各层级的 Skill，跳过隐藏目录与 node_modules，嵌套不重复", () => {
    const repo = path.join(env.root, "repo");
    writeSkill(path.join(repo, "skill-a"), "skill-a");
    writeSkill(path.join(repo, "skills", "skill-b"), "skill-b");
    writeSkill(path.join(repo, "deep", "nested", "skill-c"), "skill-c");
    writeSkill(path.join(repo, ".hidden", "skill-x"), "skill-x");
    writeSkill(path.join(repo, "node_modules", "pkg", "skill-y"), "skill-y");
    // skill-a 之下的嵌套不应重复出现
    writeSkill(path.join(repo, "skill-a", "inner"), "inner");

    const found = scanSkillsInRepo(repo);
    expect(found.map((s) => s.name)).toEqual(["skill-a", "skill-b", "skill-c"]);
    expect(found.find((s) => s.name === "skill-b")?.relativeDir).toBe(path.join("skills", "skill-b"));
    expect(found.every((s) => s.description)).toBe(true);
  });

  it("没有 SKILL.md 时返回空数组", () => {
    const repo = path.join(env.root, "empty-repo");
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    expect(scanSkillsInRepo(repo)).toEqual([]);
  });
});
