import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSkill,
  disableSkill,
  enableSkill,
  historyStatus,
  initHistory,
  listHistory,
  loadConfig,
  removeSkill,
} from "../src";
import { setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeEach(() => {
  env = setupTestEnv();
});
afterEach(() => env.cleanup());

describe("history（可选持久化接口）", () => {
  it("未配置时操作正常且不产生任何记录", () => {
    createSkill({ name: "demo", description: "演示用的 skill" });
    expect(historyStatus().enabled).toBe(false);
    expect(fs.existsSync(path.join(env.root, "anywhere", "events.ndjson"))).toBe(false);
  });

  it("init 创建空项目并写入配置；后续操作按序记录事件", () => {
    const project = path.join(env.root, "my-history");
    initHistory(project);
    expect(fs.existsSync(path.join(project, "events.ndjson"))).toBe(true);
    expect(fs.existsSync(path.join(project, "README.md"))).toBe(true);
    expect(loadConfig().history?.path).toBe(project);
    expect(historyStatus().enabled).toBe(true);

    createSkill({ name: "demo", description: "演示用的 skill", categories: ["dev"] });
    enableSkill("demo", ["codex"]);
    disableSkill("demo", ["codex"]);
    removeSkill("demo");

    const events = listHistory();
    const types = events.map((e) => e.type);
    expect(types).toEqual(["remove", "disable", "enable", "create", "history-init"]);
    expect(events.find((e) => e.type === "create")?.detail?.categories).toEqual(["dev"]);
    expect(events.every((e) => e.time)).toBe(true);
  });

  it("list 支持按名字过滤与 limit", () => {
    initHistory(path.join(env.root, "h"));
    createSkill({ name: "a-one", description: "演示用的 skill" });
    createSkill({ name: "b-two", description: "演示用的 skill" });
    expect(listHistory({ name: "a-one" })).toHaveLength(1);
    expect(listHistory({ limit: 2 })).toHaveLength(2);
  });

  it("未配置时 list 报错提示先 init", () => {
    expect(() => listHistory()).toThrow(/history init/);
  });
});
