import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSkill,
  EvalManager,
  parseEvalOutput,
  readEvalSuite,
  saveEvalSuite,
  type EvalCaseInput,
  type EvalEnvironment,
} from "../src";
import { setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeEach(() => {
  env = setupTestEnv();
});
afterEach(() => env.cleanup());

const readyEnvironment: EvalEnvironment = {
  codex: { installed: true, authenticated: true, message: "ready" },
  skillUp: { installed: true, message: "ready" },
  ready: true,
};

function cases(prefix: string): EvalCaseInput[] {
  return [
    {
      id: `${prefix}-core`,
      title: "核心任务",
      kind: "core",
      description: "验证核心行为",
      prompt: "完成核心任务",
      mustContain: [],
      mustNotContain: [],
      rubric: "准确完成任务",
    },
    {
      id: `${prefix}-edge`,
      title: "边界任务",
      kind: "boundary",
      description: "验证边界行为",
      prompt: "处理空输入",
      mustContain: [],
      mustNotContain: [],
      rubric: "不得编造",
    },
  ];
}

function writeFakeResult(
  outputDir: string,
  skillName: string,
  cases: EvalCaseInput[],
  failLast: boolean,
): void {
  const dir = path.join(outputDir, "iteration-1");
  fs.mkdirSync(dir, { recursive: true });
  const caseResults = cases.flatMap((c, index) => {
    const withStatus = failLast && index === cases.length - 1 ? "FAIL" : "PASS";
    const base = {
      case_id: c.id,
      case_title: c.title,
      input: { prompt: c.prompt },
    };
    return [
      {
        ...base,
        configuration: "with_skill",
        response: { final_message: `${skillName} with skill` },
        grading: {
          status: withStatus,
          assertion_results: [{ evidence: withStatus === "PASS" ? "符合" : "不符合" }],
        },
      },
      {
        ...base,
        configuration: "without_skill",
        response: { final_message: `${skillName} baseline` },
        grading: { status: "FAIL" },
      },
    ];
  });
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({ case_results: caseResults }));
  const withRate = failLast ? 0.5 : 1;
  fs.writeFileSync(
    path.join(dir, "benchmark.json"),
    JSON.stringify({
      run_summary: {
        with_skill: { pass_rate: { mean: withRate } },
        without_skill: { pass_rate: { mean: 0 } },
      },
    }),
  );
  fs.writeFileSync(path.join(dir, "report.html"), "<html>report</html>");
}

describe("eval suite", () => {
  it("保存并读回可视化用例，生成 skill-up 原生配置", () => {
    createSkill({ name: "demo", description: "用于测试评估流程的 Skill" });
    const saved = saveEvalSuite("demo", cases("demo"));
    expect(saved.managed).toBe(true);
    expect(readEvalSuite("demo").cases).toEqual(cases("demo"));
    const config = fs.readFileSync(saved.configPath, "utf8");
    expect(config).toContain("name: codex");
    expect(config).toContain("benchmark:");
    expect(config).toContain("enabled: true");
    const caseYaml = fs.readFileSync(
      path.join(path.dirname(saved.configPath), "cases", "demo-core.yaml"),
      "utf8",
    );
    expect(caseYaml).toContain("type: agent_judge");
    expect(caseYaml).toContain("criteria:");
    expect(caseYaml).not.toContain("kind:");
    expect(caseYaml).not.toContain("expect:\n    judge:");
  });

  it("已有自定义 evals 不允许被可视化保存覆盖", () => {
    createSkill({ name: "custom", description: "用于测试自定义评测配置的 Skill" });
    const saved = saveEvalSuite("custom", cases("custom"));
    fs.rmSync(path.join(path.dirname(saved.configPath), "skill-helm.json"));
    expect(readEvalSuite("custom").managed).toBe(false);
    expect(() => saveEvalSuite("custom", cases("changed"))).toThrow(/不会|自定义/);
  });
});

describe("EvalManager", () => {
  it("批量全部 Skill：准备、确认、串行执行并生成对照汇总", async () => {
    for (const name of ["alpha", "beta"]) {
      createSkill({ name, description: `用于批量评测的 ${name}` });
      saveEvalSuite(name, cases(name));
    }
    const executed: string[] = [];
    const manager = new EvalManager({
      environment: async () => readyEnvironment,
      runner: async (name, suite, outputDir) => {
        executed.push(name);
        writeFakeResult(outputDir, name, suite.cases, name === "beta");
        return parseEvalOutput(name, outputDir);
      },
    });
    let run = manager.create({ all: true });
    run = await manager.waitForPreparation(run.id);
    expect(run.status).toBe("draft");
    expect(run.skills.map((s) => s.status)).toEqual(["ready", "ready"]);
    expect(run.totalCaseRuns).toBe(8);

    await manager.start(run.id);
    run = await manager.waitForCompletion(run.id);
    expect(run.status).toBe("completed");
    expect(executed).toEqual(["alpha", "beta"]);
    expect(run.completedSkills).toBe(2);
    expect(run.completedCaseRuns).toBe(8);
    expect(run.skills[0]).toMatchObject({
      status: "passed",
      passed: 2,
      withSkillPassRate: 1,
      withoutSkillPassRate: 0,
      improvement: 1,
    });
    expect(run.skills[1].status).toBe("failed");
    expect(run.skills[1].cases[0].baselineStatus).toBe("FAIL");
    expect(run.skills[1].cases[0].baselineResponse).toBe("beta baseline");
    expect(fs.existsSync(run.skills[0].reportPath!)).toBe(true);
    expect(manager.list()[0].id).toBe(run.id);
  });

  it("开始前采用用户最后保存的用例数量", async () => {
    createSkill({ name: "edited", description: "用于测试用例编辑后执行的 Skill" });
    const initial = cases("edited");
    saveEvalSuite("edited", initial);
    const manager = new EvalManager({
      environment: async () => readyEnvironment,
      runner: async (name, suite, outputDir) => {
        writeFakeResult(outputDir, name, suite.cases, false);
        return parseEvalOutput(name, outputDir);
      },
    });
    let run = manager.create({ names: ["edited"] });
    run = await manager.waitForPreparation(run.id);
    saveEvalSuite("edited", [initial[0]]);
    await manager.start(run.id);
    run = await manager.waitForCompletion(run.id);
    expect(run.totalCaseRuns).toBe(2);
    expect(run.completedCaseRuns).toBe(2);
    expect(run.skills[0].caseCount).toBe(1);
  });

  it("只重试失败 Skill，保留已通过结果", async () => {
    createSkill({ name: "demo", description: "用于测试失败重试的 Skill" });
    saveEvalSuite("demo", cases("demo"));
    let shouldFail = true;
    const manager = new EvalManager({
      environment: async () => readyEnvironment,
      runner: async (name, suite, outputDir) => {
        writeFakeResult(outputDir, name, suite.cases, shouldFail);
        return parseEvalOutput(name, outputDir);
      },
    });
    let run = manager.create({ names: ["demo"] });
    run = await manager.waitForPreparation(run.id);
    await manager.start(run.id);
    run = await manager.waitForCompletion(run.id);
    expect(run.skills[0].status).toBe("failed");

    shouldFail = false;
    await manager.retry(run.id);
    run = await manager.waitForCompletion(run.id);
    expect(run.skills[0].status).toBe("passed");
    expect(run.completedSkills).toBe(1);
  });
});
