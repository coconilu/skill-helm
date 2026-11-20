import fs from "node:fs";
import path from "node:path";
import type { EvalCaseResult, EvalSkillRun } from "./eval-types";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function status(value: unknown): EvalCaseResult["status"] {
  const normalized = text(value).toUpperCase();
  return normalized === "PASS" || normalized === "FAIL" || normalized === "ERROR"
    ? normalized
    : "UNKNOWN";
}

function responseOf(raw: JsonRecord): string {
  const response = record(raw.response);
  const session = record(raw.session_result);
  const agent = record(raw.agent_result);
  return (
    text(raw.final_message) ||
    text(raw.response) ||
    text(response.final_message) ||
    text(response.message) ||
    text(session.final_message) ||
    text(agent.final_message)
  );
}

function promptOf(raw: JsonRecord): string {
  const input = record(raw.input);
  const caseData = record(raw.case);
  return text(input.prompt) || text(record(caseData.input).prompt) || text(raw.prompt);
}

function evidenceOf(raw: JsonRecord): string[] {
  const grading = record(raw.grading);
  const lists = [grading.assertion_results, grading.expectations, raw.assertion_results];
  const evidence = lists.flatMap((list) =>
    Array.isArray(list)
      ? list
          .map((item) => text(record(item).evidence) || text(record(item).message))
          .filter(Boolean)
      : [],
  );
  const direct = text(grading.evidence) || text(raw.error);
  return direct ? [...evidence, direct] : evidence;
}

function caseId(raw: JsonRecord): string {
  return text(raw.case_id) || text(raw.id) || text(record(raw.case).id);
}

function configuration(raw: JsonRecord): string {
  return text(raw.configuration) || text(raw.variant) || text(record(raw.config).name);
}

function passRate(value: unknown): number | undefined {
  const stats = record(value);
  const mean = record(stats.pass_rate).mean;
  return typeof mean === "number" && Number.isFinite(mean) ? mean : undefined;
}

export function parseEvalOutput(
  skillName: string,
  outputDir: string,
): Pick<
  EvalSkillRun,
  | "name"
  | "caseCount"
  | "passed"
  | "failed"
  | "errored"
  | "withSkillPassRate"
  | "withoutSkillPassRate"
  | "improvement"
  | "cases"
  | "outputDir"
  | "resultPath"
  | "reportPath"
> {
  const iterationDir = path.join(outputDir, "iteration-1");
  const resultPath = path.join(iterationDir, "result.json");
  if (!fs.existsSync(resultPath)) throw new Error(`skill-up 未生成结果文件: ${resultPath}`);
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8")) as JsonRecord;
  const rawCases = Array.isArray(result.case_results) ? result.case_results.map(record) : [];
  const grouped = new Map<string, JsonRecord[]>();
  for (const raw of rawCases) {
    const id = caseId(raw);
    const group = grouped.get(id) ?? [];
    group.push(raw);
    grouped.set(id, group);
  }
  const cases: EvalCaseResult[] = [...grouped.entries()].map(([id, group]) => {
    const withSkill =
      group.find((raw) => configuration(raw) === "with_skill") ??
      group.find((raw) => configuration(raw) !== "without_skill") ??
      group[0];
    const baseline = group.find((raw) => configuration(raw) === "without_skill");
    return {
      id,
      title: text(withSkill.case_title) || text(record(withSkill.case).title) || id,
      status: status(record(withSkill.grading).status || withSkill.status),
      prompt: promptOf(withSkill),
      response: responseOf(withSkill),
      evidence: evidenceOf(withSkill),
      baselineStatus: baseline
        ? status(record(baseline.grading).status || baseline.status)
        : undefined,
      baselineResponse: baseline ? responseOf(baseline) : undefined,
    };
  });
  const benchmarkPath = path.join(iterationDir, "benchmark.json");
  const benchmark = fs.existsSync(benchmarkPath)
    ? (JSON.parse(fs.readFileSync(benchmarkPath, "utf8")) as JsonRecord)
    : {};
  const summary = record(benchmark.run_summary);
  const withSkillPassRate = passRate(summary.with_skill);
  const withoutSkillPassRate = passRate(summary.without_skill);
  const reportPath = path.join(iterationDir, "report.html");
  return {
    name: skillName,
    caseCount: cases.length,
    passed: cases.filter((c) => c.status === "PASS").length,
    failed: cases.filter((c) => c.status === "FAIL").length,
    errored: cases.filter((c) => c.status === "ERROR" || c.status === "UNKNOWN").length,
    withSkillPassRate,
    withoutSkillPassRate,
    improvement:
      withSkillPassRate !== undefined && withoutSkillPassRate !== undefined
        ? withSkillPassRate - withoutSkillPassRate
        : undefined,
    cases,
    outputDir,
    resultPath,
    reportPath: fs.existsSync(reportPath) ? reportPath : undefined,
  };
}
