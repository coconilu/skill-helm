import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EvalEnvironment } from "./eval-types";

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

interface ProcessOptions {
  cwd?: string;
  input?: string;
  timeoutMs?: number;
  logPath?: string;
  onChild?: (child: ReturnType<typeof spawn>) => void;
}

export function runProcess(
  command: string,
  args: string[],
  opts: ProcessOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const log = opts.logPath ? fs.createWriteStream(opts.logPath, { flags: "a" }) : null;
    const child = spawn(command, args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    opts.onChild?.(child);
    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      log?.end();
      resolve(result);
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          terminateProcess(child);
          finish({ code: null, stdout, stderr, error: `命令执行超过 ${opts.timeoutMs}ms` });
        }, opts.timeoutMs)
      : null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-2_000_000);
      log?.write(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-1_000_000);
      log?.write(chunk);
    });
    child.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      finish({
        code: null,
        stdout,
        stderr,
        error: code === "ENOENT" ? `找不到命令: ${command}` : err.message,
      });
    });
    child.on("close", (code) => finish({ code, stdout, stderr }));
    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

export function terminateProcess(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined || child.killed) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }
}

function codexBin(): string {
  return process.env.SKILL_HELM_CODEX_BIN || "codex";
}

function skillUpBin(): string {
  return process.env.SKILL_HELM_SKILL_UP_BIN || "skill-up";
}

export function skillUpCommand(): string {
  return skillUpBin();
}

export function localCodexModel(): { provider: string; name: string } {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const configPath = path.join(home, "config.toml");
  const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const configured = config.match(/^model\s*=\s*["']([^"']+)["']/m)?.[1];
  const provider = config.match(/^model_provider\s*=\s*["']([^"']+)["']/m)?.[1];
  const override = process.env.SKILL_HELM_CODEX_MODEL;
  const name = override || configured;
  if (!name) {
    throw new Error(
      "无法确定 Codex 裁判模型：请在 ~/.codex/config.toml 设置 model，或用 SKILL_HELM_CODEX_MODEL 指定",
    );
  }
  const overrideProvider = process.env.SKILL_HELM_CODEX_PROVIDER;
  return { provider: overrideProvider || provider || "openai", name };
}

export async function detectEvalEnvironment(): Promise<EvalEnvironment> {
  const [codexVersion, codexLogin, skillUpVersion] = await Promise.all([
    runProcess(codexBin(), ["--version"], { timeoutMs: 10_000 }),
    runProcess(codexBin(), ["login", "status"], { timeoutMs: 10_000 }),
    runProcess(skillUpBin(), ["--version"], { timeoutMs: 10_000 }),
  ]);
  const codexInstalled = codexVersion.code === 0 && !codexVersion.error;
  const loginText = `${codexLogin.stdout}\n${codexLogin.stderr}`.trim();
  const authenticated =
    codexLogin.code === 0 && /logged in/i.test(loginText) && !/not logged in/i.test(loginText);
  const skillUpInstalled = skillUpVersion.code === 0 && !skillUpVersion.error;
  return {
    codex: {
      installed: codexInstalled,
      authenticated,
      version: codexInstalled ? codexVersion.stdout.trim() : undefined,
      message: !codexInstalled
        ? "未找到本地 Codex CLI，请先安装并加入 PATH"
        : authenticated
          ? "本地 Codex 已安装并登录"
          : `Codex 未登录，请先执行 codex login${loginText ? `（${loginText}）` : ""}`,
    },
    skillUp: {
      installed: skillUpInstalled,
      version: skillUpInstalled ? skillUpVersion.stdout.trim() : undefined,
      message: skillUpInstalled
        ? "skill-up 已就绪"
        : "未找到 skill-up，请从 alibaba/skill-up Releases 安装并加入 PATH",
    },
    ready: codexInstalled && authenticated && skillUpInstalled,
  };
}

function extractJsonObject(text: string): unknown {
  const candidates: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const item = event.item as Record<string, unknown> | undefined;
      for (const value of [item?.text, event.text, event.message, event.response]) {
        if (typeof value === "string") candidates.push(value);
      }
    } catch {
      // Codex JSONL 中可能混有普通提示文本，最终统一尝试提取 JSON。
    }
  }
  candidates.push(text);
  for (const candidate of candidates.reverse()) {
    const cleaned = candidate
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(cleaned.slice(start, end + 1));
        } catch {
          // 尝试上一个候选输出。
        }
      }
    }
  }
  throw new Error("Codex 没有返回合法的评测用例 JSON");
}

export async function generateCasesWithCodex(
  skillName: string,
  skillMd: string,
  cwd: string,
): Promise<unknown[]> {
  const prompt = `你是 Agent Skill 评测设计师。请根据下面的 SKILL.md，为 Skill「${skillName}」设计 4 个可在真实 Codex 中执行的快速评测用例。
要求：
1. 分别覆盖应该触发、不应该触发、核心任务、边界情况。
2. 输入必须具体、自包含，不依赖本机文件或外部服务；不要要求执行有副作用的操作。
3. 每个用例给出可判定的语义评分标准，避免只检查空泛措辞。
4. 只输出 JSON 对象，不要 Markdown：{"cases":[{"id":"英文小写连字符","title":"简短中文标题","kind":"trigger|boundary|core|regression","description":"测试目的","prompt":"给 Agent 的完整输入","mustContain":[],"mustNotContain":[],"rubric":"判分标准"}]}。
5. 没有可靠关键词时，mustContain 和 mustNotContain 留空；rubric 必填。

SKILL.md 原文：
${skillMd}`;
  const result = await runProcess(
    codexBin(),
    ["exec", "--json", "--sandbox", "read-only", "--skip-git-repo-check", "-"],
    { input: prompt, timeoutMs: 180_000, cwd },
  );
  if (result.code !== 0) {
    throw new Error(
      result.error || result.stderr.trim() || result.stdout.trim() || "Codex 生成用例失败",
    );
  }
  const parsed = extractJsonObject(result.stdout) as { cases?: unknown };
  if (!parsed || !Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error("Codex 返回的评测用例为空");
  }
  return parsed.cases;
}
