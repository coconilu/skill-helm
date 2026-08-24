import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestEnv, type TestEnv } from "../../core/test/helpers";

const CLI = path.resolve(__dirname, "../dist/cli.js");

let env: TestEnv;
beforeEach(() => {
  env = setupTestEnv();
});
afterEach(() => env.cleanup());

function run(...args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, SKILL_HELM_HOME: env.home, SKILL_HELM_ADAPTERS_DIR: path.join(env.root, "adapters") },
    encoding: "utf8",
  });
}

describe("cli e2e", () => {
  it("create → list → enable → disable 全链路 --json", () => {
    const created = JSON.parse(run("create", "e2e-skill", "--description", "端到端测试 skill", "--json"));
    expect(created.name).toBe("e2e-skill");

    const list = JSON.parse(run("list", "--json"));
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("disabled");

    const enabled = JSON.parse(run("enable", "e2e-skill", "--to", "codex,kimi", "--json"));
    expect(enabled.results.every((r: { state: string }) => r.state === "ok")).toBe(true);
    expect(fs.lstatSync(path.join(env.skillsDirFor("codex"), "e2e-skill")).isSymbolicLink()).toBe(true);

    const disabled = JSON.parse(run("disable", "e2e-skill", "--from", "codex", "--json"));
    expect(disabled.results[0].state).toBe("ok");
    expect(fs.existsSync(path.join(env.skillsDirFor("codex"), "e2e-skill"))).toBe(false);

    const shown = JSON.parse(run("show", "e2e-skill", "--json"));
    expect(shown.summary.enabledIn).toEqual(["kimi"]);
  });

  it("出错时 stdout 输出 error json，退出码非 0", () => {
    let code = 0;
    let stdout = "";
    try {
      run("enable", "ghost-skill", "--to", "codex", "--json");
    } catch (err) {
      code = (err as { status: number }).status;
      stdout = (err as { stdout: string }).stdout;
    }
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error).toMatch(/不存在/);
  });
});
