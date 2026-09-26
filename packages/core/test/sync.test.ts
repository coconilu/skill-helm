import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bindSync,
  createSkill,
  loadRegistry,
  localRepoUrl,
  paths,
  syncPull,
  syncPush,
  syncStatus,
  unbindSync,
  updateRegistry,
} from "../src";
import { setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
let remoteDir: string;
let remoteUrl: string;
let homeB: string;

beforeEach(() => {
  env = setupTestEnv();
  remoteDir = path.join(env.root, "remote.git");
  execFileSync("git", ["init", "--bare", "-b", "main", remoteDir]);
  remoteUrl = localRepoUrl(remoteDir);
  homeB = path.join(env.root, "store-b");
});

afterEach(() => env.cleanup());

function useHome(home: string): void {
  process.env.SKILL_HELM_HOME = home;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function remoteShow(file: string): string {
  return git(remoteDir, "show", `main:${file}`).trim();
}

describe("bind", () => {
  it("成功绑定：探测远端、初始化仓库与 .gitignore、写入 sync 区", async () => {
    const result = await bindSync(remoteUrl);
    expect(result).toMatchObject({ bound: true, remoteUrl, version: 0, rebound: false });
    expect(loadRegistry().sync?.remoteUrl).toBe(remoteUrl);
    expect(fs.existsSync(path.join(paths.home(), ".git"))).toBe(true);
    const gitignore = fs.readFileSync(path.join(paths.home(), ".gitignore"), "utf8");
    expect(gitignore).toContain("server.json");
    expect(gitignore).toContain("*.tmp");
    expect(git(remoteDir, "rev-parse", "--is-bare-repository").trim()).toBe("true");
  });

  it("拒绝非法 URL", async () => {
    await expect(bindSync("ftp://example.com/x")).rejects.toThrow(/不支持的远端 URL/);
    await expect(bindSync("git git git")).rejects.toThrow(/不支持的远端 URL/);
    expect(loadRegistry().sync).toBeUndefined();
  });

  it("远端不可达时报错并透传 git stderr，不写入绑定", async () => {
    const ghost = path.join(env.root, "ghost.git");
    await expect(bindSync(localRepoUrl(ghost))).rejects.toThrow(/探测远端访问权限失败/);
    expect(loadRegistry().sync).toBeUndefined();
    // 仓库与 origin 已就位，但绑定未落盘
    expect(fs.existsSync(path.join(paths.home(), ".git"))).toBe(true);
  });

  it("已绑定时再次 bind 即换绑：覆盖并报告原地址", async () => {
    const other = path.join(env.root, "other.git");
    execFileSync("git", ["init", "--bare", "-b", "main", other]);
    await bindSync(remoteUrl);
    const result = await bindSync(localRepoUrl(other));
    expect(result.rebound).toBe(true);
    expect(result.previousUrl).toBe(remoteUrl);
    expect(loadRegistry().sync?.remoteUrl).toBe(localRepoUrl(other));
    expect(git(paths.home(), "remote", "get-url", "origin").trim()).toBe(localRepoUrl(other));
  });

  it("旧版 registry.json 无 sync 区照常加载，绑定后读写往返不丢", async () => {
    fs.mkdirSync(paths.home(), { recursive: true });
    fs.writeFileSync(
      paths.registry(),
      JSON.stringify({ version: 1, skills: {}, categories: {}, groups: {} }),
      "utf8",
    );
    expect(loadRegistry().sync).toBeUndefined();
    await bindSync(remoteUrl);
    const onDisk = JSON.parse(fs.readFileSync(paths.registry(), "utf8")) as {
      sync?: { remoteUrl: string };
    };
    expect(onDisk.sync?.remoteUrl).toBe(remoteUrl);
    expect(loadRegistry().skills).toEqual({});
  });
});

describe("push", () => {
  it("版本递增、远端收到 registry/skills/SYNC.json；无变更时幂等跳过", async () => {
    await bindSync(remoteUrl);
    createSkill({ name: "alpha", description: "远端同步测试 skill" });

    const first = await syncPush();
    expect(first).toMatchObject({ pushed: true, version: 1 });
    expect(JSON.parse(remoteShow("SYNC.json")).version).toBe(1);
    expect(Object.keys(JSON.parse(remoteShow("registry.json")).skills)).toEqual(["alpha"]);
    expect(remoteShow("skills/alpha/SKILL.md")).toContain("alpha");
    expect(loadRegistry().sync?.version).toBe(1);
    expect(loadRegistry().sync?.lastSyncAt).toBeTruthy();

    const commitCount = () => Number(git(paths.home(), "rev-list", "--count", "HEAD").trim());
    expect(commitCount()).toBe(1);
    const again = await syncPush();
    expect(again).toMatchObject({ pushed: false, version: 1 });
    expect(commitCount()).toBe(1);

    createSkill({ name: "beta", description: "第二次推送" });
    const second = await syncPush();
    expect(second).toMatchObject({ pushed: true, version: 2 });
    expect(JSON.parse(remoteShow("SYNC.json")).version).toBe(2);
  });

  it("远端有新提交时拒绝并提示先 pull", async () => {
    await bindSync(remoteUrl);
    createSkill({ name: "alpha", description: "a" });
    await syncPush();

    // 另一端推了新版本，本机落后
    useHome(homeB);
    await bindSync(remoteUrl);
    await syncPull();
    createSkill({ name: "from-b", description: "b" });
    await syncPush();

    useHome(env.home);
    updateRegistry((reg) => {
      reg.categories.临时 = {};
    });
    await expect(syncPush()).rejects.toThrow(/远端有新提交.*先.*pull/s);
  });

  it("未绑定时拒绝推送", async () => {
    await expect(syncPush()).rejects.toThrow(/尚未绑定/);
  });
});

describe("pull", () => {
  it("另一端 bind + pull 拿到相同 registry 与 skills（全新仓库恢复场景）", async () => {
    useHome(env.home);
    await bindSync(remoteUrl);
    createSkill({ name: "alpha", description: "远端同步测试 skill" });
    await syncPush();

    useHome(homeB);
    await bindSync(remoteUrl);
    const pulled = await syncPull();
    expect(pulled.pulled).toBe(true);
    expect(pulled.version).toBe(1);
    expect(Array.isArray(pulled.doctorIssues)).toBe(true);

    const reg = loadRegistry();
    expect(Object.keys(reg.skills)).toEqual(["alpha"]);
    expect(reg.sync?.remoteUrl).toBe(remoteUrl);
    expect(fs.readFileSync(path.join(paths.skills(), "alpha", "SKILL.md"), "utf8")).toContain(
      "alpha",
    );
    expect(JSON.parse(fs.readFileSync(paths.syncJson(), "utf8")).version).toBe(1);

    // 已是最新时不再拉取，但仍报告 doctor
    const upToDate = await syncPull();
    expect(upToDate).toMatchObject({ pulled: false, version: 1, reason: "已是最新" });

    // 源端推 v2 后能跟上
    useHome(env.home);
    createSkill({ name: "beta", description: "v2" });
    await syncPush();
    useHome(homeB);
    const v2 = await syncPull();
    expect(v2).toMatchObject({ pulled: true, version: 2 });
    expect(fs.existsSync(path.join(paths.skills(), "beta", "SKILL.md"))).toBe(true);
  });

  it("本地有未推送提交时拒绝 pull", async () => {
    useHome(env.home);
    await bindSync(remoteUrl);
    createSkill({ name: "alpha", description: "a" });
    await syncPush();

    useHome(homeB);
    await bindSync(remoteUrl);
    await syncPull();
    // 手动制造一个未推送提交
    fs.appendFileSync(path.join(paths.skills(), "alpha", "SKILL.md"), "\n本地改动\n", "utf8");
    git(paths.home(), "add", "-A");
    git(paths.home(), "commit", "-m", "local change");

    useHome(env.home);
    createSkill({ name: "beta", description: "v2" });
    await syncPush();

    useHome(homeB);
    await expect(syncPull()).rejects.toThrow(/未推送提交.*先.*push/s);
  });

  it("本地内容与远端不同且未提交时拒绝覆盖（unborn 分叉保护）", async () => {
    useHome(env.home);
    await bindSync(remoteUrl);
    createSkill({ name: "shared", description: "来自 A 的版本" });
    await syncPush();

    useHome(homeB);
    createSkill({ name: "shared", description: "本地另一个版本" });
    await bindSync(remoteUrl);
    await expect(syncPull()).rejects.toThrow(/会覆盖它们/);
    // 本地内容原封不动
    expect(loadRegistry().skills.shared).toBeTruthy();
    expect(loadRegistry().skills.alpha).toBeUndefined();
  });

  it("远端为空时报告无需拉取", async () => {
    await bindSync(remoteUrl);
    const result = await syncPull();
    expect(result).toMatchObject({ pulled: false, reason: "远端还没有任何提交" });
  });

  it("未绑定时拒绝拉取", async () => {
    await expect(syncPull()).rejects.toThrow(/尚未绑定/);
  });
});

describe("unbind 与 status", () => {
  it("unbind 清除绑定但保留本地数据与 .git 历史", async () => {
    await bindSync(remoteUrl);
    createSkill({ name: "alpha", description: "a" });
    await syncPush();

    const result = await unbindSync();
    expect(result).toMatchObject({ unbound: true, remoteUrl, keptLocal: true });
    expect(loadRegistry().sync).toBeUndefined();
    expect(fs.existsSync(path.join(paths.home(), ".git"))).toBe(true);
    expect(fs.existsSync(path.join(paths.skills(), "alpha", "SKILL.md"))).toBe(true);

    expect(await syncStatus()).toEqual({ bound: false });
    await expect(syncPush()).rejects.toThrow(/尚未绑定/);
    await expect(syncPull()).rejects.toThrow(/尚未绑定/);
  });

  it("status 汇报可达性、版本与 ahead/behind", async () => {
    expect(await syncStatus()).toEqual({ bound: false });

    await bindSync(remoteUrl);
    expect(await syncStatus()).toMatchObject({
      bound: true,
      remoteReachable: true,
      remoteVersion: null,
      ahead: 0,
      behind: 0,
    });

    createSkill({ name: "alpha", description: "a" });
    await syncPush();
    expect(await syncStatus()).toMatchObject({
      remoteReachable: true,
      localVersion: 1,
      remoteVersion: 1,
      ahead: 0,
      behind: 0,
    });

    // 远端消失 → 不可达并带原因
    fs.rmSync(remoteDir, { recursive: true, force: true });
    const down = await syncStatus();
    expect(down.bound).toBe(true);
    expect(down.remoteReachable).toBe(false);
    expect(down.error).toBeTruthy();
  });

  it("未初始化仓库但已绑定时 status 不崩", async () => {
    await bindSync(remoteUrl);
    fs.rmSync(path.join(paths.home(), ".git"), { recursive: true, force: true });
    const status = await syncStatus();
    expect(status.bound).toBe(true);
    expect(status.localVersion).toBe(0);
  });
});
