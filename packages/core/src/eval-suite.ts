import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { generateCasesWithCodex, localCodexModel } from "./eval-process";
import type { EvalCaseInput, EvalCaseKind, EvalSuite } from "./eval-types";
import { getSkill } from "./operations";
import { skillDir } from "./store";

const MARKER = "skill-helm.json";
const KINDS: EvalCaseKind[] = ["trigger", "boundary", "core", "regression"];

function evalRoot(name: string): string {
  return path.join(skillDir(name), "evals");
}

function configPath(name: string): string {
  return path.join(evalRoot(name), "eval.yaml");
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function normalizeCase(value: unknown, index: number): EvalCaseInput {
  const raw = (value ?? {}) as Record<string, unknown>;
  const idBase = typeof raw.id === "string" ? raw.id : `case-${index + 1}`;
  const id =
    idBase
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `case-${index + 1}`;
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  return {
    id,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : id,
    kind: KINDS.includes(raw.kind as EvalCaseKind) ? (raw.kind as EvalCaseKind) : "core",
    description,
    prompt,
    mustContain: stringList(raw.mustContain),
    mustNotContain: stringList(raw.mustNotContain),
    rubric:
      typeof raw.rubric === "string" && raw.rubric.trim()
        ? raw.rubric.trim()
        : "回答应准确完成输入任务，遵守 Skill 的约束，不得编造事实或执行有副作用的操作。",
  };
}

function validateCases(cases: EvalCaseInput[]): void {
  if (cases.length === 0) throw new Error("至少需要一条评测用例");
  const ids = new Set<string>();
  for (const c of cases) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id)) throw new Error(`非法用例 id: ${c.id}`);
    if (ids.has(c.id)) throw new Error(`用例 id 重复: ${c.id}`);
    ids.add(c.id);
    if (!c.prompt.trim()) throw new Error(`用例 ${c.id} 缺少输入`);
    if (!c.rubric.trim() && c.mustContain.length === 0 && c.mustNotContain.length === 0) {
      throw new Error(`用例 ${c.id} 至少需要一个断言或语义评分标准`);
    }
  }
}

function writeSuite(name: string, cases: EvalCaseInput[]): EvalSuite {
  validateCases(cases);
  const root = evalRoot(name);
  fs.mkdirSync(path.join(root, "cases"), { recursive: true });
  const judgeModel = cases.some((c) => c.rubric) ? localCodexModel() : null;
  const files = cases.map((c) => {
    const relative = `evals/cases/${c.id}.yaml`;
    const input: Record<string, unknown> = { prompt: c.prompt };
    const expect: Record<string, unknown> = {};
    if (c.mustContain.length > 0) expect.must_contain = c.mustContain;
    if (c.mustNotContain.length > 0) expect.must_not_contain = c.mustNotContain;
    const judge = c.rubric
      ? {
          judge: {
            type: "agent_judge",
            engine: { name: "codex", model: judgeModel },
            criteria: [c.rubric],
            pass_threshold: 1,
          },
        }
      : {};
    fs.writeFileSync(
      path.join(root, "cases", `${c.id}.yaml`),
      yaml.dump(
        {
          id: c.id,
          title: c.title,
          description: c.description,
          input,
          expect,
          ...judge,
        },
        { lineWidth: 120 },
      ),
      "utf8",
    );
    return relative;
  });
  const config = {
    schema_version: "v1alpha1",
    environment: { type: "none" },
    engine: { name: "codex" },
    cases: {
      files,
      defaults: { timeout_seconds: 180, max_turns: 8 },
      parallelism: 1,
    },
    benchmark: { enabled: true },
    report: { formats: ["json", "html"] },
  };
  fs.writeFileSync(configPath(name), yaml.dump(config, { lineWidth: 120 }), "utf8");
  fs.writeFileSync(
    path.join(root, MARKER),
    `${JSON.stringify(
      {
        version: 1,
        generator: "skill-helm",
        caseKinds: Object.fromEntries(cases.map((c) => [c.id, c.kind])),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { name, configPath: configPath(name), exists: true, managed: true, cases };
}

export function readEvalSuite(name: string): EvalSuite {
  getSkill(name);
  const file = configPath(name);
  if (!fs.existsSync(file)) {
    return { name, configPath: file, exists: false, managed: true, cases: [] };
  }
  const config = yaml.load(fs.readFileSync(file, "utf8")) as {
    cases?: { files?: unknown };
  };
  const files = stringList(config.cases?.files);
  const markerPath = path.join(evalRoot(name), MARKER);
  const marker = fs.existsSync(markerPath)
    ? (JSON.parse(fs.readFileSync(markerPath, "utf8")) as {
        caseKinds?: Record<string, EvalCaseKind>;
      })
    : {};
  const cases = files.map((relative, index) => {
    const root = skillDir(name);
    const casePath = path.resolve(root, relative);
    const outside = path.relative(root, casePath);
    if (outside.startsWith("..") || path.isAbsolute(outside)) {
      throw new Error(`评测用例路径超出 Skill 目录: ${relative}`);
    }
    const raw = yaml.load(fs.readFileSync(casePath, "utf8")) as Record<string, unknown>;
    const input = (raw.input ?? {}) as Record<string, unknown>;
    const expect = (raw.expect ?? {}) as Record<string, unknown>;
    const judge = (raw.judge ?? expect.judge ?? {}) as Record<string, unknown>;
    return normalizeCase(
      {
        ...raw,
        kind: marker.caseKinds?.[String(raw.id)] ?? raw.kind,
        prompt: input.prompt,
        mustContain: expect.must_contain,
        mustNotContain: expect.must_not_contain,
        rubric: judge.rubric ?? (Array.isArray(judge.criteria) ? judge.criteria.join("\n") : ""),
      },
      index,
    );
  });
  return {
    name,
    configPath: file,
    exists: true,
    managed: fs.existsSync(path.join(evalRoot(name), MARKER)),
    cases,
  };
}

export async function prepareEvalSuite(name: string): Promise<EvalSuite> {
  const existing = readEvalSuite(name);
  if (existing.exists) return existing;
  const file = path.join(skillDir(name), "SKILL.md");
  const generated = await generateCasesWithCodex(
    name,
    fs.readFileSync(file, "utf8"),
    skillDir(name),
  );
  const cases = generated.map(normalizeCase).filter((c) => c.prompt);
  const unique = cases.map((c, index) => {
    if (cases.findIndex((other) => other.id === c.id) === index) return c;
    return { ...c, id: `${c.id}-${index + 1}` };
  });
  return writeSuite(name, unique);
}

export function saveEvalSuite(name: string, cases: EvalCaseInput[]): EvalSuite {
  const existing = readEvalSuite(name);
  if (existing.exists && !existing.managed) {
    throw new Error("该 Skill 已有自定义 evals，请直接编辑 YAML，避免覆盖高级配置");
  }
  return writeSuite(name, cases.map(normalizeCase));
}
