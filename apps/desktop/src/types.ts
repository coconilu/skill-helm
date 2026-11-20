/** 与 packages/core 的 API 响应对应的轻量类型。 */

export interface SkillSummary {
  name: string;
  description: string;
  status: "enabled" | "disabled";
  enabledIn: string[];
  categories: string[];
  groups: string[];
  tags: string[];
  source: string;
  updatedAt: string;
  registered: boolean;
  links: { adapter: string; path: string; state: string }[];
}

export interface LintIssue {
  level: "error" | "warning";
  rule: string;
  message: string;
}

export interface SkillDetail {
  summary: SkillSummary;
  issues: LintIssue[];
}

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
  codex: { installed: boolean; authenticated: boolean; version?: string; message: string };
  skillUp: { installed: boolean; version?: string; message: string };
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

export interface EvalRunSummary {
  id: string;
  status: EvalRunStatus;
  createdAt: string;
  updatedAt: string;
  skillCount: number;
  completedSkills: number;
  currentSkill?: string;
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

export interface Meta {
  /** CLI 自身版本（packages/cli/package.json），用于 sidecar 与 App 的版本对账。 */
  version: string;
  adapters: { id: string; covers: string[] }[];
  store: string;
  history: { enabled: boolean; path?: string; events: number };
}

export interface DoctorIssue {
  type: string;
  name?: string;
  adapter?: string;
  message: string;
  fixed: boolean;
}

/** 同步状态（对应 core 的 SyncStatus；lastSyncAt 由 server 从 registry 合并）。 */
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
  /** 上次同步时间（ISO）。 */
  lastSyncAt?: string;
}

/** 绑定/换绑结果（对应 core 的 SyncBindResult）。 */
export interface SyncBindResult {
  bound: true;
  remoteUrl: string;
  version: number;
  /** true = 对已绑定状态再次 bind（换绑）。 */
  rebound: boolean;
  previousUrl?: string;
}

/** 解除绑定结果（对应 core 的 SyncUnbindResult）；本地数据与 .git 历史保留。 */
export interface SyncUnbindResult {
  unbound: true;
  remoteUrl?: string;
  keptLocal: true;
}

/** 推送结果（对应 core 的 SyncPushResult）。 */
export interface SyncPushResult {
  pushed: boolean;
  version: number;
  rev?: string;
  reason?: string;
}

/** 拉取结果（对应 core 的 SyncPullResult）。 */
export interface SyncPullResult {
  pulled: boolean;
  version: number;
  rev?: string;
  reason?: string;
  doctorIssues: DoctorIssue[];
}

/** 托管方升级方式（对应 core 的 ManagerUpgrade）。 */
export interface ManagerUpgrade {
  description: string;
  /** 可直接复制执行的升级命令；为空表示没有 CLI 途径。 */
  commands: string[];
  manual?: string;
  versionHint?: string;
}

/** 第三方托管方元数据（对应 core 的 ThirdPartyManager）。 */
export interface ThirdPartyManager {
  id: string;
  label: string;
  description: string;
  prefixes: string[];
  upgrade: ManagerUpgrade;
}

/** 已登记的第三方 skill 条目（对应 core 的 ThirdPartyEntryView）。 */
export interface ThirdPartyEntryView {
  name: string;
  adapterId: string;
  managedBy: string;
  category: string;
  registeredAt: string;
  manager: ThirdPartyManager;
  exists: boolean;
}

/** 托管方版本探测结果（对应 core 的 ManagerVersionInfo）；null 表示未知。 */
export interface ManagerVersionInfo {
  current: string | null;
  latest: string | null;
}

/** 扫描发现的未登记第三方 skill 目录。 */
export interface ThirdPartyCandidate {
  name: string;
  adapterId: string;
  managedBy: string;
}
