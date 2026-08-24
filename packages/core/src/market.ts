import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { lintDir } from "./lint";
import { registerInstalledSkill } from "./operations";
import { assertValidName, readSkillInfo } from "./skills";
import { ensureStore, skillDir } from "./store";
import type { LintIssue } from "./types";

const UA = { "User-Agent": "skill-helm", Accept: "application/vnd.github+json" };

function httpsGet(url: string, redirects = 5): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: UA }, (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirects > 0) {
          res.resume();
          resolve(httpsGet(res.headers.location, redirects - 1));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

export interface MarketCandidate {
  source: "github";
  repo: string;
  description: string;
  stars: number;
  url: string;
  defaultBranch: string;
}

/** 按用户描述搜索 Skill 仓库（GitHub 仓库搜索）。名称含 skills 的仓库优先，readme 提及 SKILL.md 的次之。 */
export async function searchGitHub(query: string, limit = 10): Promise<MarketCandidate[]> {
  const perPage = Math.min(Math.max(limit, 1), 25);
  const run = async (q: string): Promise<MarketCandidate[]> => {
    const { status, body } = await httpsGet(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perPage}`,
    );
    if (status !== 200) {
      throw new Error(`GitHub 搜索失败（HTTP ${status}）：${body.slice(0, 200).toString("utf8")}`);
    }
    const data = JSON.parse(body.toString("utf8")) as {
      items?: { full_name: string; description: string | null; stargazers_count: number; html_url: string; default_branch?: string }[];
    };
    return (data.items ?? []).map((it) => ({
      source: "github" as const,
      repo: it.full_name,
      description: it.description ?? "",
      stars: it.stargazers_count ?? 0,
      url: it.html_url,
      defaultBranch: it.default_branch ?? "main",
    }));
  };
  const byTopic = await run(`${query} topic:agent-skills`);
  const byName = await run(`${query} in:description skills in:name`);
  const byReadme = await run(`${query} SKILL.md in:readme`);
  const seen = new Set<string>();
  return [...byTopic, ...byName, ...byReadme]
    .filter((c) => {
      if (seen.has(c.repo)) return false;
      seen.add(c.repo);
      return true;
    })
    .slice(0, limit);
}

export interface RepoSkill {
  name: string;
  dir: string;
  relativeDir: string;
  description: string;
}

/** 扫描仓库目录里的 Skill（含 SKILL.md 的目录；跳过隐藏目录与 node_modules，找到即不再向下嵌套）。 */
export function scanSkillsInRepo(root: string): RepoSkill[] {
  const out: RepoSkill[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === "SKILL.md")) {
      const info = readSkillInfo(dir);
      out.push({
        name: info?.name || path.basename(dir),
        dir,
        relativeDir: path.relative(root, dir) || ".",
        description: info?.description ?? "",
      });
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface InstallResult {
  installed: { name: string; issues: LintIssue[] }[];
  /** 仓库含多个 Skill 且未指定 --skill 时返回候选，由用户选择。 */
  candidates?: RepoSkill[];
}

/** 从 GitHub 仓库安装 Skill 进库存（tar.gz 下载 + 扫描 + 复制；不经用户确认的路径在 CLI 层拦截）。 */
export async function installFromGitHub(repo: string, opts: { skill?: string } = {}): Promise<InstallResult> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`仓库格式应为 owner/name，收到: ${repo}`);
  const infoRes = await httpsGet(`https://api.github.com/repos/${repo}`);
  if (infoRes.status !== 200) throw new Error(`找不到仓库 ${repo}（HTTP ${infoRes.status}）`);
  const branch = (JSON.parse(infoRes.body.toString("utf8")) as { default_branch?: string }).default_branch ?? "main";

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-helm-market-"));
  try {
    const tarPath = path.join(tmp, "repo.tar.gz");
    const dl = await httpsGet(`https://codeload.github.com/${repo}/tar.gz/refs/heads/${branch}`);
    if (dl.status !== 200) throw new Error(`下载 ${repo}@${branch} 失败（HTTP ${dl.status}）`);
    fs.writeFileSync(tarPath, dl.body);
    const extractDir = path.join(tmp, "x");
    fs.mkdirSync(extractDir, { recursive: true });
    await tar.x({ file: tarPath, cwd: extractDir });
    const top = fs
      .readdirSync(extractDir)
      .map((d) => path.join(extractDir, d))
      .find((p) => fs.statSync(p).isDirectory());
    if (!top) throw new Error("下载的压缩包内容为空");

    const skills = scanSkillsInRepo(top);
    if (skills.length === 0) throw new Error(`${repo} 中没有找到任何 SKILL.md`);

    let picks: RepoSkill[];
    if (opts.skill === "all") picks = skills;
    else if (opts.skill) {
      picks = skills.filter((s) => s.name === opts.skill);
      if (picks.length === 0) {
        throw new Error(`${repo} 里没有名为 "${opts.skill}" 的 Skill；实际有: ${skills.map((s) => s.name).join(", ")}`);
      }
    } else if (skills.length === 1) picks = skills;
    else return { installed: [], candidates: skills };

    const installed: { name: string; issues: LintIssue[] }[] = [];
    for (const s of picks) {
      assertValidName(s.name);
      const target = skillDir(s.name);
      if (fs.existsSync(target)) throw new Error(`库存中已存在 ${s.name}；如需更新请先 rm 后重装`);
      ensureStore();
      fs.cpSync(s.dir, target, { recursive: true });
      registerInstalledSkill(s.name, `github:${repo}`);
      installed.push({ name: s.name, issues: lintDir(target, s.name) });
    }
    return { installed };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
