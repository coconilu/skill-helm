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

export interface Meta {
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

export interface MarketCandidate {
  source: string;
  repo: string;
  description: string;
  stars: number;
  url: string;
}

export interface RepoSkill {
  name: string;
  relativeDir: string;
  description: string;
}

export interface InstallResult {
  installed: { name: string; issues: LintIssue[] }[];
  candidates?: RepoSkill[];
}

export interface HistoryEvent {
  time: string;
  type: string;
  name?: string;
  detail?: Record<string, unknown>;
}
