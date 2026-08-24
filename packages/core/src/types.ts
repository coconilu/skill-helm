/** Skill Helm 核心类型。状态事实 = 库存目录 + junction；registry.json 只记录元数据与意图。 */

export interface AdapterConfig {
  id: string;
  skillsDir: string;
}

export interface SkillMeta {
  /** 已启用到的 adapter id 列表；空数组即禁用状态（status 由它派生，不单独存储）。 */
  enabledIn: string[];
  categories: string[];
  groups: string[];
  tags: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface Registry {
  version: number;
  skills: Record<string, SkillMeta>;
  categories: Record<string, { description?: string }>;
  groups: Record<string, { description?: string; categories?: string[] }>;
}

export type LinkState = "ok" | "missing" | "broken" | "conflict" | "foreign";

export interface LinkInfo {
  adapter: string;
  path: string;
  state: LinkState;
}

export interface SkillSummary extends SkillMeta {
  name: string;
  description: string;
  status: "enabled" | "disabled";
  registered: boolean;
  links: LinkInfo[];
}

export interface LintIssue {
  level: "error" | "warning";
  rule: string;
  message: string;
}

export interface TargetResult {
  adapter: string;
  state: "ok" | "already" | "error";
  message?: string;
}

export interface DoctorIssue {
  type:
    | "registry-missing-dir"
    | "unregistered"
    | "link-drift"
    | "unmanaged";
  name?: string;
  adapter?: string;
  message: string;
  fixed: boolean;
}
