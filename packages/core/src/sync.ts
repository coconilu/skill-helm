import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { doctor } from "./operations";
import { loadRegistry, updateRegistry } from "./registry";
import { ensureStore, paths } from "./store";
import type { DoctorIssue, SyncBinding } from "./types";

/** 同步仓库固定使用 main 分支（bind 时由 symbolic-ref 保证）。 */
const SYNC_BRANCH = "main";
const GIT_TIMEOUT_MS = 30_000;
/** 本地仓库的忽略清单：临时文件与机器本地状态不入库。.gitignore 只在本机生效，永不被提交。 */
const GITIGNORE = ["server.json", "*.tmp", "registry.lock", "config.json", ".gitignore"].join("\n");

/** 同步操作失败；message 已包含 git stderr 关键行（认证失败时附登录提示）。 */
export class SyncError extends Error {}

interface GitRun {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** spawn 执行 git：超时杀进程、捕获 stdout/stderr。GIT_TERMINAL_PROMPT=0 防止挂起等凭据输入。 */
function execGit(args: string[], cwd: string, timeoutMs = GIT_TIMEOUT_MS): Promise<GitRun> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT")
        reject(new SyncError("未找到 git 命令，请确认已安装 Git 且在 PATH 中"));
      else reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function stderrKeyLines(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(-6).join("\n");
}

/** 认证交给本机 git 凭据（Windows 凭据管理器 / macOS 钥匙串 / gh），失败时提示用户自查登录。 */
function isAuthFailure(stderr: string): boolean {
  return /authentication|permission denied|access denied|could not read username|terminal prompts|invalid credentials|403|log in|登录/i.test(
    stderr,
  );
}

async function git(args: string[], cwd: string, what: string): Promise<string> {
  let run: GitRun;
  try {
    run = await execGit(args, cwd);
  } catch (err) {
    if (err instanceof SyncError) throw err;
    throw new SyncError(`${what}失败：${err instanceof Error ? err.message : String(err)}`);
  }
  if (run.timedOut) throw new SyncError(`${what}超时（${GIT_TIMEOUT_MS}ms），请检查网络或远端仓库`);
  if (run.code !== 0) {
    const key = stderrKeyLines(run.stderr) || stderrKeyLines(run.stdout) || "git 无输出";
    const hint = isAuthFailure(run.stderr)
      ? "\n认证可能失败：请确认本机已登录该私有仓库（凭据由本机 git 管理：Windows 凭据管理器 / macOS 钥匙串 / gh auth login）。"
      : "";
    throw new SyncError(`${what}失败：\n${key}${hint}`);
  }
  return run.stdout;
}

async function gitOut(args: string[], cwd: string, what: string): Promise<string> {
  return (await git(args, cwd, what)).trim();
}

function syncFile(): string {
  return paths.syncJson();
}

function readSyncVersion(): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(syncFile(), "utf8")) as { version?: unknown };
    return typeof parsed.version === "number" ? parsed.version : 0;
  } catch {
    return 0;
  }
}

function writeSyncVersion(version: number): void {
  fs.writeFileSync(syncFile(), `${JSON.stringify({ version }, null, 2)}\n`, "utf8");
}

function requireBinding(): SyncBinding {
  const binding = loadRegistry().sync;
  if (!binding) throw new Error("尚未绑定远端仓库，请先执行 skill-helm sync bind <url>");
  return binding;
}

/** 库存根目录即同步仓库；缺 .git 时初始化（main 分支 + 提交身份兜底），并维护 .gitignore。 */
async function ensureRepo(): Promise<string> {
  const home = paths.home();
  ensureStore();
  if (!fs.existsSync(path.join(home, ".git"))) {
    await git(["init"], home, "初始化本地同步仓库");
    await git(["symbolic-ref", "HEAD", `refs/heads/${SYNC_BRANCH}`], home, "设置默认分支");
  }
  const gitignore = path.join(home, ".gitignore");
  if (!fs.existsSync(gitignore) || fs.readFileSync(gitignore, "utf8").trim() !== GITIGNORE)
    fs.writeFileSync(gitignore, `${GITIGNORE}\n`, "utf8");
  const email = (await execGit(["config", "user.email"], home)).stdout.trim();
  if (!email) {
    await git(["config", "user.email", "skill-helm@local"], home, "配置提交身份");
    await git(["config", "user.name", "skill-helm"], home, "配置提交身份");
  }
  return home;
}

function isValidRemoteUrl(url: string): boolean {
  if (/\s/.test(url)) return false;
  return /^(git@[\w.-]+:|ssh:\/\/|https?:\/\/|file:\/\/)/i.test(url);
}

/** 远端分支清单（ls-remote --heads）；空 = 远端还没有任何提交。 */
async function remoteState(
  home: string,
): Promise<{ empty: true } | { empty: false; branch: string }> {
  const out = await gitOut(["ls-remote", "--heads", "origin"], home, "探测远端分支");
  const refs = out
    .split("\n")
    .map((l) => l.split("\t")[1]?.trim())
    .filter((r): r is string => Boolean(r));
  if (refs.length === 0) return { empty: true };
  const branch = (refs.find((r) => r === `refs/heads/${SYNC_BRANCH}`) ?? refs[0]!).replace(
    "refs/heads/",
    "",
  );
  return { empty: false, branch };
}

async function isUnborn(home: string): Promise<boolean> {
  return (await execGit(["rev-parse", "--verify", "-q", "HEAD"], home)).code !== 0;
}

async function aheadBehind(
  home: string,
  branch: string,
  unborn: boolean,
): Promise<{ ahead: number; behind: number }> {
  const ref = `origin/${branch}`;
  if (unborn) {
    const behind = Number(await gitOut(["rev-list", "--count", ref], home, "统计落后提交"));
    return { ahead: 0, behind };
  }
  const out = await gitOut(
    ["rev-list", "--left-right", "--count", `HEAD...${ref}`],
    home,
    "统计领先/落后提交",
  );
  const [ahead, behind] = out.split(/\s+/).map(Number);
  return { ahead: ahead ?? 0, behind: behind ?? 0 };
}

async function remoteSyncVersion(home: string, branch: string): Promise<number> {
  try {
    const parsed = JSON.parse(
      await gitOut(["show", `origin/${branch}:SYNC.json`], home, "读取远端 SYNC.json"),
    ) as { version?: unknown };
    return typeof parsed.version === "number" ? parsed.version : 0;
  } catch {
    return 0;
  }
}

export interface SyncBindResult {
  bound: true;
  remoteUrl: string;
  /** 绑定时的本地版本号（SYNC.json，缺省 0）。 */
  version: number;
  /** true = 对已绑定状态再次 bind（换绑），原绑定见 previousUrl。 */
  rebound: boolean;
  previousUrl?: string;
}

/** 绑定/换绑远端：校验 URL → git init → ls-remote 探测访问（认证交给本机凭据）→ 写入绑定。 */
export async function bindSync(url: string): Promise<SyncBindResult> {
  const remoteUrl = url.trim();
  if (!isValidRemoteUrl(remoteUrl))
    throw new Error(
      `不支持的远端 URL：${remoteUrl}（支持 git@host:path / ssh:// / https:// / file://）`,
    );
  const previous = loadRegistry().sync;
  await ensureRepo();
  const home = paths.home();
  const remotes = await gitOut(["remote"], home, "读取远端配置");
  if (remotes.split(/\s+/).includes("origin"))
    await git(["remote", "set-url", "origin", remoteUrl], home, "更新远端地址");
  else await git(["remote", "add", "origin", remoteUrl], home, "写入远端地址");
  await git(["ls-remote", "origin"], home, "探测远端访问权限");
  const version = readSyncVersion();
  updateRegistry((reg) => {
    reg.sync = {
      remoteUrl,
      version,
      lastSyncAt: new Date().toISOString(),
      lastSyncRev: previous?.lastSyncRev,
    };
  });
  return {
    bound: true,
    remoteUrl,
    version,
    rebound: Boolean(previous),
    previousUrl: previous?.remoteUrl,
  };
}

export interface SyncUnbindResult {
  unbound: true;
  remoteUrl?: string;
  /** 本地数据与 .git 历史均保留，仅解除绑定。 */
  keptLocal: true;
}

/** 解除绑定：清掉 registry 的 sync 区与 origin 远端配置；库存数据与 .git 历史保留。 */
export async function unbindSync(): Promise<SyncUnbindResult> {
  const previous = requireBinding();
  updateRegistry((reg) => {
    reg.sync = undefined;
  });
  const home = paths.home();
  if (fs.existsSync(path.join(home, ".git"))) await execGit(["remote", "remove", "origin"], home);
  return { unbound: true, remoteUrl: previous.remoteUrl, keptLocal: true };
}

export interface SyncStatus {
  bound: boolean;
  remoteUrl?: string;
  remoteReachable?: boolean;
  /** 探测失败原因（remoteReachable=false 时）。 */
  error?: string;
  /** 本地版本（SYNC.json）。 */
  localVersion?: number;
  /** 远端版本；null = 远端还没有任何提交。 */
  remoteVersion?: number | null;
  /** 本地领先（未推送）提交数。 */
  ahead?: number;
  /** 本地落后（未拉取）提交数。 */
  behind?: number;
}

/** 绑定状态、远端可达性、本地↔远端版本（vM ↔ vN）与 ahead/behind 计数。只读，不改任何文件。 */
export async function syncStatus(): Promise<SyncStatus> {
  const binding = loadRegistry().sync;
  if (!binding) return { bound: false };
  const base: SyncStatus = {
    bound: true,
    remoteUrl: binding.remoteUrl,
    localVersion: readSyncVersion() || binding.version,
  };
  const home = paths.home();
  try {
    if (!fs.existsSync(path.join(home, ".git"))) throw new Error("本地同步仓库尚未初始化");
    const state = await remoteState(home);
    await git(["fetch", "origin"], home, "获取远端状态");
    const unborn = await isUnborn(home);
    if (state.empty) {
      const ahead = unborn
        ? 0
        : Number(await gitOut(["rev-list", "--count", "HEAD"], home, "统计提交"));
      return { ...base, remoteReachable: true, remoteVersion: null, ahead, behind: 0 };
    }
    const { ahead, behind } = await aheadBehind(home, state.branch, unborn);
    return {
      ...base,
      remoteReachable: true,
      remoteVersion: await remoteSyncVersion(home, state.branch),
      ahead,
      behind,
    };
  } catch (err) {
    return {
      ...base,
      remoteReachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface SyncPushResult {
  pushed: boolean;
  /** 推送后的版本号（未推送时为当前版本）。 */
  version: number;
  rev?: string;
  reason?: string;
}

const SYNC_PATHS = ["skills", "concepts", "registry.json", "SYNC.json"];

/** git add 对空目录可能报 pathspec 错误，只暂存实际有内容的路径。 */
function stageTargets(home: string): string[] {
  return SYNC_PATHS.filter((p) => {
    const full = path.join(home, p);
    if (!fs.existsSync(full)) return false;
    try {
      return fs.statSync(full).isFile() || fs.readdirSync(full).length > 0;
    } catch {
      return false;
    }
  });
}

/** 推送：暂存 skills/concepts/registry/SYNC.json → 版本 +1 → commit → push。
 * 远端有新提交（落后）时拒绝并提示先 pull；无变更且已同步时幂等跳过。 */
export async function syncPush(): Promise<SyncPushResult> {
  const binding = requireBinding();
  const home = await ensureRepo();
  await git(["fetch", "origin"], home, "获取远端状态");
  const state = await remoteState(home);
  const unborn = await isUnborn(home);
  if (!state.empty) {
    const { behind } = await aheadBehind(home, state.branch, unborn);
    if (behind > 0) {
      const remoteV = await remoteSyncVersion(home, state.branch);
      throw new Error(
        `远端有新提交（本地落后 ${behind} 个提交，远端 v${remoteV}），请先执行 skill-helm sync pull 再推送`,
      );
    }
  }
  let version = readSyncVersion();
  if (!fs.existsSync(syncFile())) writeSyncVersion(version);
  const targets = stageTargets(home);
  if (targets.length === 0) targets.push("SYNC.json");
  await git(["add", "--", ...targets], home, "暂存同步内容");
  const staged = (await execGit(["diff", "--cached", "--quiet"], home)).code !== 0;
  if (!staged) {
    if (!unborn) {
      // 无新变更：若仍有未推送提交（如上次推送中断）则补推，否则幂等跳过
      const ahead = state.empty
        ? Number(await gitOut(["rev-list", "--count", "HEAD"], home, "统计提交"))
        : (await aheadBehind(home, state.branch, unborn)).ahead;
      if (ahead > 0) {
        await git(["push", "origin", SYNC_BRANCH], home, "推送到远端");
        const rev = await gitOut(["rev-parse", "HEAD"], home, "读取提交");
        return { pushed: true, version, rev, reason: "无新变更，推送已有提交" };
      }
    }
    return { pushed: false, version, reason: "无变更，无需推送" };
  }
  version += 1;
  const now = new Date().toISOString();
  writeSyncVersion(version);
  updateRegistry((reg) => {
    reg.sync = {
      remoteUrl: binding.remoteUrl,
      version,
      lastSyncAt: now,
      lastSyncRev: reg.sync?.lastSyncRev,
    };
  });
  await git(["add", "registry.json", "SYNC.json"], home, "暂存版本信息");
  await git(["commit", "-m", `sync: 推送 v${version}`], home, "创建同步提交");
  await git(["push", "origin", SYNC_BRANCH], home, "推送到远端");
  const rev = await gitOut(["rev-parse", "HEAD"], home, "读取提交");
  return { pushed: true, version, rev };
}

/** 本地 registry 是否没有实际内容（仅默认空结构；sync 绑定区不算内容）。 */
function isEffectivelyEmptyRegistry(file: string): boolean {
  try {
    const reg = JSON.parse(fs.readFileSync(file, "utf8")) as {
      skills?: object;
      categories?: object;
      groups?: object;
      thirdParty?: object;
    };
    return (
      Object.keys(reg.skills ?? {}).length === 0 &&
      Object.keys(reg.categories ?? {}).length === 0 &&
      Object.keys(reg.groups ?? {}).length === 0 &&
      Object.keys(reg.thirdParty ?? {}).length === 0
    );
  } catch {
    return false;
  }
}

/** 全新仓库（无任何提交）拉取远端：git 会拒绝覆盖未跟踪文件，先做安全清点。
 * 仅清掉「内容相同」「空 registry」「初始 SYNC.json」「concepts 派生文件」；
 * 其余与远端不同且未提交的内容一律拒绝，绝不强制覆盖。 */
async function prepareUnbornMerge(home: string, originRef: string): Promise<void> {
  const files = (
    await gitOut(["ls-tree", "-r", "--name-only", originRef], home, "读取远端文件清单")
  )
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const clear: string[] = [];
  const unsafe: string[] = [];
  for (const file of files) {
    const localPath = path.join(home, ...file.split("/"));
    if (!fs.existsSync(localPath)) continue;
    const incoming = await gitOut(["show", `${originRef}:${file}`], home, "读取远端文件");
    if (incoming === fs.readFileSync(localPath, "utf8")) {
      clear.push(file);
      continue;
    }
    if (file === "registry.json" && isEffectivelyEmptyRegistry(localPath)) {
      clear.push(file);
      continue;
    }
    if (file === "SYNC.json" && readSyncVersion() === 0) {
      clear.push(file);
      continue;
    }
    // concepts/ 由 skill-helm concepts sync 从包内再生，属派生数据，可被远端覆盖
    if (file.startsWith("concepts/")) {
      clear.push(file);
      continue;
    }
    unsafe.push(file);
  }
  if (unsafe.length > 0)
    throw new Error(
      `本地以下文件与远端不同且未提交，快进拉取会覆盖它们：\n  ${unsafe.join("\n  ")}\n` +
        `请先备份、提交或手动合并后再 pull；若本地是可丢弃的初始库存，可删除 ${home} 后重新 bind。skill-helm 不会强制覆盖本地内容。`,
    );
  for (const file of clear) fs.rmSync(path.join(home, ...file.split("/")), { force: true });
}

export interface SyncPullResult {
  pulled: boolean;
  /** 拉取后到达的版本号（未拉取时为当前版本）。 */
  version: number;
  rev?: string;
  reason?: string;
  doctorIssues: DoctorIssue[];
}

/** 拉取：fetch → 版本/提交比对 → 仅快进合并 → doctor。
 * 本地有未推送提交时拒绝并提示先 push；分叉/冲突时报错并指引手动处理，绝不 reset --hard / 强推。 */
export async function syncPull(): Promise<SyncPullResult> {
  requireBinding();
  const home = await ensureRepo();
  await git(["fetch", "origin"], home, "获取远端");
  const state = await remoteState(home);
  const unborn = await isUnborn(home);
  if (state.empty)
    return {
      pulled: false,
      version: readSyncVersion(),
      reason: "远端还没有任何提交",
      doctorIssues: doctor(false),
    };
  const originRef = `origin/${state.branch}`;
  const { ahead, behind } = await aheadBehind(home, state.branch, unborn);
  if (!unborn && ahead > 0)
    throw new Error(
      `本地有 ${ahead} 个未推送提交，请先执行 skill-helm sync push，再拉取（skill-helm 不会强制覆盖本地内容）`,
    );
  if (behind === 0 && !unborn)
    return {
      pulled: false,
      version: readSyncVersion(),
      reason: "已是最新",
      doctorIssues: doctor(false),
    };
  if (unborn) await prepareUnbornMerge(home, originRef);
  try {
    await git(["merge", "--ff-only", originRef], home, "快进合并远端提交");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/local changes|untracked working tree/i.test(message))
      throw new Error(
        `快进合并失败——本地存在未提交修改，git 拒绝覆盖：\n${stderrKeyLines(message)}\n` +
          `请先执行 skill-helm sync push 提交本地修改；若 push 因远端新提交被拒绝，请手动处理本地修改后重试。`,
      );
    throw err;
  }
  return {
    pulled: true,
    version: readSyncVersion(),
    rev: await gitOut(["rev-parse", "HEAD"], home, "读取提交"),
    doctorIssues: doctor(false),
  };
}

/** 测试辅助：把本地目录转成 file:// 远端 URL。 */
export function localRepoUrl(dir: string): string {
  return pathToFileURL(dir).href;
}
