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

export interface HistoryEvent {
  time: string;
  type: string;
  name?: string;
  detail?: Record<string, unknown>;
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
