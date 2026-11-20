import { randomUUID } from "node:crypto";
import type { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  detectEvalEnvironment,
  runProcess,
  skillUpCommand,
  terminateProcess,
} from "./eval-process";
import { parseEvalOutput } from "./eval-report";
import { prepareEvalSuite, readEvalSuite } from "./eval-suite";
import type {
  CreateEvalBatchOptions,
  EvalRun,
  EvalEnvironment,
  EvalRunSummary,
  EvalSkillRun,
  EvalSuite,
} from "./eval-types";
import { getSkill, listSkills } from "./operations";
import { paths, skillDir } from "./store";

type Child = ReturnType<typeof spawn>;
type Runner = (
  name: string,
  suite: EvalSuite,
  outputDir: string,
  onChild: (child: Child) => void,
) => Promise<Partial<EvalSkillRun>>;

async function runSkillUp(
  name: string,
  suite: EvalSuite,
  outputDir: string,
  onChild: (child: Child) => void,
): Promise<Partial<EvalSkillRun>> {
  fs.mkdirSync(outputDir, { recursive: true });
  const logPath = path.join(outputDir, "skill-up.log");
  const validation = await runProcess(skillUpCommand(), ["validate", suite.configPath], {
    cwd: skillDir(name),
    timeoutMs: 30_000,
    logPath,
    onChild,
  });
  if (validation.code !== 0) {
    throw new Error(validation.error || validation.stderr.trim() || "skill-up 配置校验失败");
  }
  const result = await runProcess(
    skillUpCommand(),
    [
      "run",
      suite.configPath,
      "--output-dir",
      outputDir,
      "--parallelism",
      "1",
      "--baseline",
      "--iteration",
      "1",
      "--format",
      "html",
    ],
    {
      cwd: skillDir(name),
      logPath,
      onChild,
    },
  );
  try {
    return parseEvalOutput(name, outputDir);
  } catch (err) {
    const detail = result.error || result.stderr.trim() || result.stdout.trim();
    throw new Error(detail || (err as Error).message);
  }
}

function now(): string {
  return new Date().toISOString();
}

function emptySkillRun(name: string): EvalSkillRun {
  return {
    name,
    status: "pending",
    caseCount: 0,
    passed: 0,
    failed: 0,
    errored: 0,
    cases: [],
  };
}

export class EvalManager {
  private activeId: string | null = null;
  private activeChild: Child | null = null;
  private cancelRequested = new Set<string>();
  private readonly runner: Runner;
  private readonly environment: () => Promise<EvalEnvironment>;

  constructor(opts: { runner?: Runner; environment?: () => Promise<EvalEnvironment> } = {}) {
    this.runner = opts.runner ?? runSkillUp;
    this.environment = opts.environment ?? detectEvalEnvironment;
    for (const run of this.list()) {
      if (!["preparing", "queued", "running"].includes(run.status)) continue;
      const full = this.get(run.id);
      full.status = "failed";
      full.error = "服务重启，未完成任务已停止";
      full.finishedAt = now();
      this.save(full);
    }
  }

  private dir(id: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("非法评测任务 id");
    return path.join(paths.evalRuns(), id);
  }

  private save(run: EvalRun): void {
    run.updatedAt = now();
    const dir = this.dir(run.id);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, "run.json.tmp");
    fs.writeFileSync(tmp, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, path.join(dir, "run.json"));
  }

  get(id: string): EvalRun {
    const file = path.join(this.dir(id), "run.json");
    if (!fs.existsSync(file)) throw new Error(`评测任务不存在: ${id}`);
    return JSON.parse(fs.readFileSync(file, "utf8")) as EvalRun;
  }

  list(limit = 30): EvalRunSummary[] {
    const root = paths.evalRuns();
    if (!fs.existsSync(root)) return [];
    return fs
      .readdirSync(root)
      .map((id): EvalRunSummary | null => {
        try {
          const run = this.get(id);
          return {
            id: run.id,
            status: run.status,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            skillCount: run.skills.length,
            completedSkills: run.completedSkills,
            currentSkill: run.currentSkill,
          };
        } catch {
          return null;
        }
      })
      .filter((run): run is EvalRunSummary => run !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  create(opts: CreateEvalBatchOptions): EvalRun {
    if (this.activeId) throw new Error("已有评测任务正在准备或运行");
    let names = opts.all
      ? listSkills(opts.enabledOnly ? { status: "enabled" } : {}).map((s) => s.name)
      : [...new Set(opts.names ?? [])];
    if (!opts.all && opts.enabledOnly) {
      const enabled = new Set(listSkills({ status: "enabled" }).map((s) => s.name));
      names = names.filter((name) => enabled.has(name));
    }
    if (names.length === 0) throw new Error("请至少选择一个 Skill");
    for (const name of names) getSkill(name);
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const run: EvalRun = {
      id,
      status: "preparing",
      engine: "codex",
      mode: "quick",
      createdAt: now(),
      updatedAt: now(),
      skills: names.map(emptySkillRun),
      completedSkills: 0,
      totalCaseRuns: 0,
      completedCaseRuns: 0,
    };
    this.save(run);
    this.activeId = id;
    void this.prepare(id);
    return run;
  }

  private async prepare(id: string): Promise<void> {
    try {
      for (const item of this.get(id).skills) {
        if (this.cancelRequested.has(id)) break;
        const current = this.get(id);
        const target = current.skills.find((s) => s.name === item.name)!;
        target.status = "preparing";
        current.currentSkill = item.name;
        this.save(current);
        try {
          const suite = await prepareEvalSuite(item.name);
          const next = this.get(id);
          const updated = next.skills.find((s) => s.name === item.name)!;
          updated.status = "ready";
          updated.caseCount = suite.cases.length;
          this.save(next);
        } catch (err) {
          const next = this.get(id);
          const updated = next.skills.find((s) => s.name === item.name)!;
          updated.status = "error";
          updated.error = (err as Error).message;
          this.save(next);
        }
      }
      const run = this.get(id);
      run.totalCaseRuns = run.skills.reduce((sum, s) => sum + s.caseCount * 2, 0);
      run.currentSkill = undefined;
      if (this.cancelRequested.has(id)) {
        run.status = "cancelled";
        run.finishedAt = now();
      } else if (run.skills.some((s) => s.status === "ready")) {
        run.status = "draft";
      } else {
        run.status = "failed";
        run.error = "没有可执行的评测用例";
        run.finishedAt = now();
      }
      this.save(run);
    } finally {
      if (this.activeId === id) this.activeId = null;
    }
  }

  async waitForPreparation(id: string): Promise<EvalRun> {
    while (this.get(id).status === "preparing") {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return this.get(id);
  }

  async waitForCompletion(id: string): Promise<EvalRun> {
    while (["queued", "running"].includes(this.get(id).status)) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return this.get(id);
  }

  async start(id: string): Promise<EvalRun> {
    if (this.activeId) throw new Error("已有评测任务正在准备或运行");
    this.activeId = id;
    try {
      const run = this.get(id);
      if (run.status !== "draft") throw new Error("只有已准备好的评测任务可以开始");
      const environment = await this.environment();
      if (!environment.ready) throw new Error("本地 Codex 或 skill-up 尚未就绪");
      for (const item of run.skills) {
        if (item.status === "ready") item.caseCount = readEvalSuite(item.name).cases.length;
      }
      run.totalCaseRuns = run.skills.reduce((sum, s) => sum + s.caseCount * 2, 0);
      const runnable = run.skills.filter((s) => s.status === "ready" && s.caseCount > 0);
      if (runnable.length === 0) throw new Error("没有可执行的评测用例");
      this.cancelRequested.delete(id);
      run.status = "queued";
      run.startedAt = now();
      run.error = undefined;
      this.save(run);
      void this.execute(id);
      return run;
    } catch (err) {
      if (this.activeId === id) this.activeId = null;
      throw err;
    }
  }

  private async execute(id: string): Promise<void> {
    try {
      const initial = this.get(id);
      initial.status = "running";
      this.save(initial);
      for (const item of initial.skills) {
        if (this.cancelRequested.has(id)) break;
        if (item.status !== "ready") continue;
        let run = this.get(id);
        const target = run.skills.find((s) => s.name === item.name)!;
        target.status = "running";
        target.startedAt = now();
        target.error = undefined;
        run.currentSkill = item.name;
        this.save(run);
        try {
          const suite = readEvalSuite(item.name);
          const outputDir = path.join(this.dir(id), "results", item.name);
          const result = await this.runner(item.name, suite, outputDir, (child) => {
            this.activeChild = child;
          });
          if (result.cases) {
            result.cases = result.cases.map((c) => ({
              ...c,
              title: suite.cases.find((input) => input.id === c.id)?.title || c.title,
            }));
          }
          run = this.get(id);
          const updated = run.skills.find((s) => s.name === item.name)!;
          Object.assign(updated, result);
          updated.status =
            this.cancelRequested.has(id) || result.status === "cancelled"
              ? "cancelled"
              : updated.errored > 0
                ? "error"
                : updated.failed > 0
                  ? "failed"
                  : "passed";
          updated.finishedAt = now();
        } catch (err) {
          run = this.get(id);
          const updated = run.skills.find((s) => s.name === item.name)!;
          updated.status = this.cancelRequested.has(id) ? "cancelled" : "error";
          updated.error = (err as Error).message;
          updated.finishedAt = now();
        } finally {
          this.activeChild = null;
          run.completedSkills += 1;
          run.completedCaseRuns += item.caseCount * 2;
          this.save(run);
        }
      }
      const run = this.get(id);
      run.currentSkill = undefined;
      run.status = this.cancelRequested.has(id) ? "cancelled" : "completed";
      run.finishedAt = now();
      this.save(run);
    } catch (err) {
      const run = this.get(id);
      run.status = "failed";
      run.error = (err as Error).message;
      run.finishedAt = now();
      this.save(run);
    } finally {
      this.activeChild = null;
      if (this.activeId === id) this.activeId = null;
    }
  }

  cancel(id: string): EvalRun {
    const run = this.get(id);
    if (!["preparing", "draft", "queued", "running"].includes(run.status)) return run;
    this.cancelRequested.add(id);
    if (run.status === "draft") {
      run.status = "cancelled";
      run.finishedAt = now();
      this.save(run);
      return run;
    }
    if (this.activeChild) terminateProcess(this.activeChild);
    return run;
  }

  async retry(id: string): Promise<EvalRun> {
    if (this.activeId) throw new Error("已有评测任务正在准备或运行");
    const run = this.get(id);
    if (["preparing", "queued", "running"].includes(run.status)) {
      throw new Error("任务仍在运行，不能重试");
    }
    const failed = run.skills.filter((s) => ["failed", "error", "cancelled"].includes(s.status));
    if (failed.length === 0) throw new Error("没有失败或取消的 Skill 需要重试");
    for (const item of failed) {
      const fresh = emptySkillRun(item.name);
      Object.assign(item, fresh, {
        status: "ready",
        caseCount: readEvalSuite(item.name).cases.length,
      });
    }
    run.completedSkills = run.skills.filter((s) => s.status === "passed").length;
    run.completedCaseRuns =
      run.completedSkills > 0
        ? run.skills
            .filter((s) => s.status === "passed")
            .reduce((sum, s) => sum + s.caseCount * 2, 0)
        : 0;
    run.totalCaseRuns = run.skills.reduce((sum, s) => sum + s.caseCount * 2, 0);
    run.status = "draft";
    run.finishedAt = undefined;
    this.save(run);
    return this.start(id);
  }

  reportDir(id: string): string {
    const dir = this.dir(id);
    if (!fs.existsSync(dir)) throw new Error(`评测任务不存在: ${id}`);
    return dir;
  }
}
