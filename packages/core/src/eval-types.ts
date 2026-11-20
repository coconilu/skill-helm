export type EvalCaseKind = "trigger" | "boundary" | "core" | "regression";

export interface EvalCaseInput {
  id: string;
  title: string;
  kind: EvalCaseKind;
  description: string;
  prompt: string;
  mustContain: string[];
  mustNotContain: string[];
  rubric: string;
}

export interface EvalSuite {
  name: string;
  configPath: string;
  exists: boolean;
  managed: boolean;
  cases: EvalCaseInput[];
}

export interface EvalEnvironment {
  codex: {
    installed: boolean;
    authenticated: boolean;
    version?: string;
    message: string;
  };
  skillUp: {
    installed: boolean;
    version?: string;
    message: string;
  };
  ready: boolean;
}

export type EvalRunStatus =
  | "preparing"
  | "draft"
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export type EvalSkillStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "running"
  | "passed"
  | "failed"
  | "error"
  | "cancelled";

export interface EvalCaseResult {
  id: string;
  title: string;
  status: "PASS" | "FAIL" | "ERROR" | "UNKNOWN";
  prompt: string;
  response: string;
  evidence: string[];
  baselineStatus?: "PASS" | "FAIL" | "ERROR" | "UNKNOWN";
  baselineResponse?: string;
}

export interface EvalSkillRun {
  name: string;
  status: EvalSkillStatus;
  caseCount: number;
  passed: number;
  failed: number;
  errored: number;
  withSkillPassRate?: number;
  withoutSkillPassRate?: number;
  improvement?: number;
  error?: string;
  cases: EvalCaseResult[];
  outputDir?: string;
  resultPath?: string;
  reportPath?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface EvalRun {
  id: string;
  status: EvalRunStatus;
  engine: "codex";
  mode: "quick";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  skills: EvalSkillRun[];
  currentSkill?: string;
  completedSkills: number;
  totalCaseRuns: number;
  completedCaseRuns: number;
  error?: string;
}

export interface EvalRunSummary {
  id: string;
  status: EvalRunStatus;
  createdAt: string;
  updatedAt: string;
  skillCount: number;
  completedSkills: number;
  currentSkill?: string;
}

export interface CreateEvalBatchOptions {
  names?: string[];
  all?: boolean;
  enabledOnly?: boolean;
}
