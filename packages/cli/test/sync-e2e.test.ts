import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestEnv, type TestEnv } from "../../core/test/helpers";

const CLI = path.resolve(__dirname, "../dist/cli.js");

let env: TestEnv;
let remoteDir: string;
let remoteUrl: string;

beforeEach(() => {
  env = setupTestEnv();
  remoteDir = path.join(env.root, "remote.git");
  execFileSync("git", ["init", "--bare", "-b", "main", remoteDir]);
  remoteUrl = pathToFileURL(remoteDir).href;
});

afterEach(() => env.cleanup());

interface RunResult {
  stdout: string;
  status: number;
}

function run(...args: string[]): RunResult {
  try {
    return {
      stdout: execFileSync(process.execPath, [CLI, ...args], {
        env: {
          ...process.env,
          SKILL_HELM_HOME: env.home,
          SKILL_HELM_ADAPTERS_DIR: path.join(env.root, "adapters"),
        },
        encoding: "utf8",
      }),
      status: 0,
    };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { stdout: e.stdout ?? "", status: e.status };
  }
}

describe("cli sync e2e", () => {
  it("bind → push → status → pull → unbind 全链路 --json", () => {
    const bound = JSON.parse(run("sync", "bind", remoteUrl, "--json").stdout);
    expect(bound).toMatchObject({ bound: true, remoteUrl, version: 0, rebound: false });

    expect(run("sync", "bind", "not a url", "--json").status).not.toBe(0);

    const created = JSON.parse(
      run("create", "sync-e2e", "--description", "sync e2e 测试", "--json").stdout,
    );
    expect(created.name).toBe("sync-e2e");

    const pushed = JSON.parse(run("sync", "push", "--json").stdout);
    expect(pushed).toMatchObject({ pushed: true, version: 1 });
    const pushedAgain = JSON.parse(run("sync", "push", "--json").stdout);
    expect(pushedAgain).toMatchObject({ pushed: false, version: 1 });

    const status = JSON.parse(run("sync", "status", "--json").stdout);
    expect(status).toMatchObject({
      bound: true,
      remoteReachable: true,
      localVersion: 1,
      remoteVersion: 1,
      ahead: 0,
      behind: 0,
    });

    const pulled = JSON.parse(run("sync", "pull", "--json").stdout);
    expect(pulled).toMatchObject({ pulled: false, version: 1, reason: "已是最新" });

    const unbound = JSON.parse(run("sync", "unbind", "--json").stdout);
    expect(unbound).toMatchObject({ unbound: true, remoteUrl, keptLocal: true });
    expect(JSON.parse(run("sync", "status", "--json").stdout)).toEqual({ bound: false });
    expect(fs.existsSync(path.join(env.home, ".git"))).toBe(true);
  });

  it("文本输出包含版本号与同步指引；未绑定时友好提示", () => {
    expect(run("sync", "status").stdout).toContain("未绑定");
    run("sync", "bind", remoteUrl);
    expect(run("sync", "status").stdout).toContain("本地 v0");
    run("create", "t-sync", "--description", "文本输出测试");
    expect(run("sync", "push").stdout).toContain("已推送 v1");
    expect(run("sync", "pull").stdout).toContain("已是最新");
  });

  it("远端有新提交时 push 失败并提示先 pull（退出码非 0）", () => {
    run("sync", "bind", remoteUrl);
    run("create", "t-push", "--description", "push 测试");
    expect(run("sync", "push", "--json").status).toBe(0);

    // 直接在远端追加一个提交，模拟另一端推送
    const work = path.join(env.root, "simulated-peer");
    execFileSync("git", ["clone", "-q", remoteDir, work]);
    fs.writeFileSync(path.join(work, "SYNC.json"), '{"version": 9}\n', "utf8");
    execFileSync("git", ["-C", work, "add", "-A"]);
    execFileSync("git", [
      "-C",
      work,
      "-c",
      "user.email=p@p",
      "-c",
      "user.name=p",
      "commit",
      "-qm",
      "peer",
    ]);
    execFileSync("git", ["-C", work, "push", "-q", "origin", "main"]);

    const refused = run("sync", "push", "--json");
    expect(refused.status).not.toBe(0);
    expect(JSON.parse(refused.stdout).error).toMatch(/先.*pull/s);
  });
});
