/** Skill Helm 核心类型。状态事实 = 库存目录 + junction；registry.json 只记录元数据与意图。 */

export interface AdapterConfig {
  id: string;
  skillsDir: string;
  /** 该目录会被哪些 agent（适配器 id）读取。启用它与启用被覆盖的适配器效果重叠，UI/调用方应互斥处理。 */
  covers?: string[];
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

/** 第三方托管登记：只管理不收编（不搬移/不改写目录），由外部工具（托管方）自管升级。 */
export interface ThirdPartyEntry {
  /** 所在适配器根目录的 adapter id。 */
  adapterId: string;
  /** 托管方 id（见 core 的 THIRD_PARTY_MANAGERS：chatcut / lark / hyperframes）。 */
  managedBy: string;
  category: string;
  registeredAt: string;
}

export interface Registry {
  version: number;
  skills: Record<string, SkillMeta>;
  categories: Record<string, { description?: string }>;
  groups: Record<string, { description?: string; categories?: string[] }>;
  /** 旧版 registry.json 无此字段，加载时补空对象。 */
  thirdParty: Record<string, ThirdPartyEntry>;
  /** Git 同步绑定（sync 命令）；旧版 registry.json 无此字段，加载时保持 undefined。 */
  sync?: SyncBinding;
}

/** 与私有 Git 远端同步的绑定状态，随 registry.json 一起同步。 */
export interface SyncBinding {
  remoteUrl: string;
  /** 单调递增的同步版本号，与库存根目录 SYNC.json 一致；每次 push +1。 */
  version: number;
  lastSyncAt?: string;
  lastSyncRev?: string;
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
  type: "registry-missing-dir" | "unregistered" | "link-drift" | "unmanaged";
  name?: string;
  adapter?: string;
  message: string;
  fixed: boolean;
}
