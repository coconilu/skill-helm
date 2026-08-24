import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adoptSkill,
  createSkill,
  disableSkill,
  doctor,
  enableSkill,
  getSkill,
  lintDir,
  listSkills,
  loadRegistry,
  removeSkill,
  skillDir,
  updateSkill,
} from "../src";
import { setupTestEnv, writeSkill, type TestEnv } from "./helpers";

let env: TestEnv;
beforeEach(() => {
  env = setupTestEnv();
});
afterEach(() => env.cleanup());

describe("create / list / show", () => {
  it("create 生成模板并登记，list 可见，show 有描述", () => {
    createSkill({ name: "demo-skill", description: "演示用的 skill", categories: ["dev"], groups: ["g1"] });
    const list = listSkills();
    expect(list.map((s) => s.name)).toEqual(["demo-skill"]);
    expect(list[0].status).toBe("disabled");
    const { summary, issues } = getSkill("demo-skill");
    expect(summary.description).toBe("演示用的 skill");
    expect(summary.categories).toEqual(["dev"]);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(loadRegistry().categories["dev"]).toBeDefined();
  });

  it("重复创建报错；非法名字报错", () => {
    createSkill({ name: "demo", description: "演示用的 skill" });
    expect(() => createSkill({ name: "demo", description: "另一个描述" })).toThrow(/已存在/);
    expect(() => createSkill({ name: "Bad_Name", description: "演示用的 skill" })).toThrow(/非法/);
  });

  it("按分类/状态过滤", () => {
    createSkill({ name: "a-one", description: "演示用的 skill", categories: ["media"] });
    createSkill({ name: "b-two", description: "演示用的 skill" });
    expect(listSkills({ category: "media" }).map((s) => s.name)).toEqual(["a-one"]);
    enableSkill("a-one", ["codex"]);
    expect(listSkills({ status: "enabled" }).map((s) => s.name)).toEqual(["a-one"]);
  });
});

describe("enable / disable", () => {
  it("enable 建 junction，disable 移除且库存文件保留", () => {
    createSkill({ name: "demo", description: "演示用的 skill" });
    const { results } = enableSkill("demo", ["codex", "kimi"]);
    expect(results.every((r) => r.state === "ok")).toBe(true);
    const link = path.join(env.skillsDirFor("codex"), "demo");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(link, "SKILL.md"))).toBe(true);
    expect(getSkill("demo").summary.enabledIn.sort()).toEqual(["codex", "kimi"]);

    // 幂等
    expect(enableSkill("demo", ["codex"]).results[0].state).toBe("already");

    disableSkill("demo", ["codex"]);
    expect(fs.existsSync(link)).toBe(false);
    expect(fs.existsSync(path.join(skillDir("demo"), "SKILL.md"))).toBe(true);
    expect(getSkill("demo").summary.enabledIn).toEqual(["kimi"]);
  });

  it("目标位置被真实目录占用时报错，不覆盖", () => {
    createSkill({ name: "demo", description: "演示用的 skill" });
    writeSkill(path.join(env.skillsDirFor("codex"), "demo"), "demo");
    const { results } = enableSkill("demo", ["codex"]);
    expect(results[0].state).toBe("error");
    expect(fs.lstatSync(path.join(env.skillsDirFor("codex"), "demo")).isSymbolicLink()).toBe(false);
  });

  it("enable 不存在的 skill 报错", () => {
    expect(() => enableSkill("ghost", ["codex"])).toThrow(/不存在/);
  });
});

describe("update / categorize", () => {
  it("update --description 只改 frontmatter", () => {
    createSkill({ name: "demo", description: "演示用的 skill" });
    updateSkill("demo", { description: "新的触发描述", categories: ["docs"] });
    const { summary } = getSkill("demo");
    expect(summary.description).toBe("新的触发描述");
    const content = fs.readFileSync(path.join(skillDir("demo"), "SKILL.md"), "utf8");
    expect(content).toContain("## 何时使用");
  });
});

describe("adopt", () => {
  it("收编 adapter 目录里的 skill：移入库存、原位留 junction、报告同名冲突", () => {
    writeSkill(path.join(env.skillsDirFor("codex"), "my-skill"), "my-skill");
    writeSkill(path.join(env.skillsDirFor("kimi"), "my-skill"), "my-skill");
    const { summary, conflicts } = adoptSkill(path.join(env.skillsDirFor("codex"), "my-skill"));
    expect(summary.source).toBe("adopted");
    expect(summary.enabledIn).toEqual(["codex"]);
    expect(fs.existsSync(path.join(skillDir("my-skill"), "SKILL.md"))).toBe(true);
    expect(fs.lstatSync(path.join(env.skillsDirFor("codex"), "my-skill")).isSymbolicLink()).toBe(true);
    expect(conflicts.map((c) => c.adapter)).toEqual(["kimi"]);
    // kimi 下的真实目录未被触碰
    expect(fs.lstatSync(path.join(env.skillsDirFor("kimi"), "my-skill")).isSymbolicLink()).toBe(false);
  });

  it("非 Skill 目录拒绝收编", () => {
    const dir = path.join(env.root, "not-a-skill");
    fs.mkdirSync(dir);
    expect(() => adoptSkill(dir)).toThrow(/SKILL\.md/);
  });
});

describe("rm", () => {
  it("启用中拒绝删除，禁用后可删除", () => {
    createSkill({ name: "demo", description: "演示用的 skill" });
    enableSkill("demo", ["codex"]);
    expect(() => removeSkill("demo")).toThrow(/禁用/);
    disableSkill("demo", ["codex"]);
    removeSkill("demo");
    expect(fs.existsSync(skillDir("demo"))).toBe(false);
    expect(loadRegistry().skills["demo"]).toBeUndefined();
  });
});

describe("lint", () => {
  it("发现命名与 description 问题", () => {
    const dir = path.join(env.root, "BadName");
    writeSkill(dir, "BadName", "短");
    const issues = lintDir(dir);
    expect(issues.some((i) => i.rule === "naming" && i.level === "error")).toBe(true);
    expect(issues.some((i) => i.rule === "description" && i.level === "warning")).toBe(true);
  });

  it("正文过短或没有章节标题时给出 body 警告", () => {
    const dir = path.join(env.root, "thin-skill");
    writeSkill(dir, "thin-skill"); // 正文只有一行标题
    const issues = lintDir(dir);
    expect(issues.some((i) => i.rule === "body" && i.message.includes("正文过短"))).toBe(true);
  });

  it("create 生成的模板通过 lint（无 error、无 body 警告）", () => {
    createSkill({ name: "good-skill", description: "一个质量合格的 skill" });
    const { issues } = getSkill("good-skill");
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(issues.filter((i) => i.rule === "body")).toEqual([]);
  });
});

describe("doctor", () => {
  it("发现未登记库存目录与未收编 skill，--fix 登记", () => {
    writeSkill(skillDir("store-only"), "store-only");
    writeSkill(path.join(env.skillsDirFor("codex"), "outside"), "outside");
    let issues = doctor(false);
    expect(issues.some((i) => i.type === "unregistered" && i.name === "store-only")).toBe(true);
    expect(issues.some((i) => i.type === "unmanaged" && i.name === "outside")).toBe(true);
    issues = doctor(true);
    expect(loadRegistry().skills["store-only"]).toBeDefined();
  });

  it("registry 启用声明与磁盘漂移时可修复", () => {
    createSkill({ name: "demo", description: "演示用的 skill" });
    enableSkill("demo", ["codex"]);
    fs.rmSync(path.join(env.skillsDirFor("codex"), "demo"));
    const issues = doctor(true);
    expect(issues.some((i) => i.type === "link-drift" && i.fixed)).toBe(true);
    expect(fs.lstatSync(path.join(env.skillsDirFor("codex"), "demo")).isSymbolicLink()).toBe(true);
  });
});
