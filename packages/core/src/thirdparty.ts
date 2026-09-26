import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadAdapters } from "./adapters";
import { recordEvent } from "./history";
import { loadRegistry, updateRegistry } from "./registry";
import type { ThirdPartyEntry } from "./types";

/** 托管方升级方式：说明 + 可复制命令（供 UI 拷贝按钮展示），无 CLI 时给用户操作路径。 */
export interface ManagerUpgrade {
  description: string;
  /** 可直接复制执行的升级命令；为空表示没有 CLI 途径。 */
  commands: string[];
  /** 没有 CLI 命令时的用户操作路径（如应用内更新）。 */
  manual?: string;
  /** 提示用户如何自查最新版本（平台不做联网探测，避免脆弱依赖）。 */
  versionHint?: string;
}

/** 第三方托管方元数据：登记匹配规则 + 真实升级方式。 */
export interface ThirdPartyManager {
  id: string;
  label: string;
  description: string;
  /** 按目录名前缀匹配该托管方的 skill（scan 用；显式登记不受限）。 */
  prefixes: string[];
  upgrade: ManagerUpgrade;
  /** best-effort 本地当前版本探测（不联网；拿不到返回 null，UI 降级显示未知）。 */
  versionProbe?: { cmd: string; args: string[]; timeoutMs?: number };
}

/**
 * 本机三个托管方的真实升级方式（2026-09 实测）：
 * - chatcut：ChatCut Desktop 安装并用 ~/.agents/skills/.chatcut-desktop-skills.json 内容哈希跟踪，
 *   随应用/manifest 更新自动重装，无 CLI 命令——所以严禁搬移这些目录。
 * - lark：lark-cli（@larksuite/cli）内嵌 skill 内容（lark-cli skills list/read），磁盘 lark-* 为导出副本；
 *   `lark-cli update` 自动识别 npm 安装方式升级。
 * - hyperframes：`npx hyperframes skills update` 更新已装 skill 包（skills check 只检查）；
 *   CLI 经 npx 运行，版本由 npm 分发。
 */
export const THIRD_PARTY_MANAGERS: ThirdPartyManager[] = [
  {
    id: "chatcut",
    label: "ChatCut Desktop",
    description: "ChatCut Desktop 安装并自管理的 skill 包（chatcut-* 等）。",
    prefixes: ["chatcut-"],
    upgrade: {
      description:
        "由 ChatCut Desktop 自管理：skill 包随应用/manifest 更新自动重新安装，无需手动升级。" +
        "请勿手动修改、搬移或改名这些目录（ChatCut 会按 manifest 内容哈希重装，改动会被覆盖）。",
      commands: [],
      manual: "打开 ChatCut Desktop → 检查并安装应用更新；更新后 skill 包自动同步到最新。",
      versionHint: "当前版本未在磁盘暴露，显示为未知；可在 ChatCut Desktop 的关于/更新面板查看。",
    },
  },
  {
    id: "lark",
    label: "lark-cli（飞书）",
    description:
      "lark-cli（@larksuite/cli）体系的 lark-* skill；最新内容内嵌在 CLI 二进制里（lark-cli skills list / read），磁盘目录是导出副本。",
    prefixes: ["lark-"],
    upgrade: {
      description:
        "升级 lark-cli 即携带最新 skill 内容；CLI 升级后磁盘副本需要重新导出/覆盖才会同步。",
      commands: ["lark-cli update --check", "lark-cli update"],
      versionHint: "lark-cli --version 查当前版本；lark-cli update --check 查最新版本。",
    },
    versionProbe: { cmd: "lark-cli", args: ["--version"], timeoutMs: 8000 },
  },
  {
    id: "hyperframes",
    label: "HyperFrames CLI",
    description:
      "hyperframes CLI 安装的 HyperFrames skill 包（hyperframes、hyperframes-core/-animation/-cli 等）。",
    prefixes: ["hyperframes"],
    upgrade: {
      description:
        "用 hyperframes 的 skills 子命令检查/更新已安装的 skill 包；CLI 本体经 npx 运行，版本由 npm 分发。",
      commands: ["npx hyperframes skills check", "npx hyperframes skills update"],
      versionHint: "npx hyperframes upgrade --check --json 同时给出当前/最新版本。",
    },
    versionProbe: {
      cmd: "npx",
      args: ["--no-install", "hyperframes", "--version"],
      timeoutMs: 15000,
    },
  },
];

export function listManagers(): ThirdPartyManager[] {
  return THIRD_PARTY_MANAGERS;
}

export function getManager(id: string): ThirdPartyManager {
  const m = THIRD_PARTY_MANAGERS.find((x) => x.id === id);
  if (!m) {
    const known = THIRD_PARTY_MANAGERS.map((x) => x.id).join(", ");
    throw new Error(`未知托管方: ${id}（当前已知: ${known}）`);
  }
  return m;
}

function matchesPrefix(name: string, prefix: string): boolean {
  return name === prefix || name.startsWith(prefix.endsWith("-") ? prefix : `${prefix}-`);
}

/** 按目录名前缀判断 skill 属于哪个托管方；都不匹配返回 undefined。 */
export function matchManager(name: string): ThirdPartyManager | undefined {
  return THIRD_PARTY_MANAGERS.find((m) => m.prefixes.some((p) => matchesPrefix(name, p)));
}

export interface ThirdPartyEntryView extends ThirdPartyEntry {
  name: string;
  manager: ThirdPartyManager;
  /** 目录当前是否仍存在于登记的适配器根目录下（托管方可能移除/重装）。 */
  exists: boolean;
}

function toView(name: string, entry: ThirdPartyEntry): ThirdPartyEntryView {
  const dir = path.join(
    loadAdapters().find((a) => a.id === entry.adapterId)?.skillsDir ?? "",
    name,
  );
  return {
    ...entry,
    name,
    manager: getManager(entry.managedBy),
    exists: fs.existsSync(dir) && fs.lstatSync(dir).isDirectory(),
  };
}

export function listThirdParty(
  filter: { managedBy?: string; adapterId?: string } = {},
): ThirdPartyEntryView[] {
  const reg = loadRegistry();
  return Object.entries(reg.thirdParty)
    .map(([name, entry]) => toView(name, entry))
    .filter(
      (v) =>
        (!filter.managedBy || v.managedBy === filter.managedBy) &&
        (!filter.adapterId || v.adapterId === filter.adapterId),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface ThirdPartyCandidate {
  name: string;
  adapterId: string;
  managedBy: string;
}

/** 扫描各适配器根目录：未被库存/第三方登记占用、能按前缀匹配到托管方的目录。 */
export function scanThirdParty(): ThirdPartyCandidate[] {
  const reg = loadRegistry();
  const out: ThirdPartyCandidate[] = [];
  for (const a of loadAdapters()) {
    if (!fs.existsSync(a.skillsDir)) continue;
    for (const d of fs.readdirSync(a.skillsDir)) {
      if (d.startsWith(".")) continue;
      const p = path.join(a.skillsDir, d);
      const st = fs.lstatSync(p);
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      if (reg.skills[d] || reg.thirdParty[d]) continue;
      const m = matchManager(d);
      if (m) out.push({ name: d, adapterId: a.id, managedBy: m.id });
    }
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

export interface RegisterThirdPartyResult {
  registered: ThirdPartyEntryView[];
  skipped: { name: string; reason: string }[];
}

/** 定位 name 所在适配器：显式给 adapterId 时校验，否则在全部适配器根目录中唯一命中。 */
function locateAdapter(name: string, adapterId?: string): string {
  const adapters = loadAdapters();
  if (adapterId) {
    const a = adapters.find((x) => x.id === adapterId);
    if (!a) throw new Error(`未知适配器: ${adapterId}`);
    if (!fs.existsSync(path.join(a.skillsDir, name)))
      throw new Error(`${adapterId} 下不存在目录: ${name}`);
    return adapterId;
  }
  const hits = adapters.filter((a) => fs.existsSync(path.join(a.skillsDir, name))).map((a) => a.id);
  if (hits.length === 0) throw new Error(`任何适配器根目录下都不存在目录: ${name}`);
  if (hits.length > 1)
    throw new Error(`${name} 在多个适配器下都存在（${hits.join(", ")}），请用 --adapter 指定`);
  return hits[0]!;
}

/**
 * 批量登记第三方 skill：只写 registry.thirdParty，不搬移目录、不改写任何 skill 文件。
 * 幂等：已登记的（同名同托管方）跳过；托管方不同的也跳过并说明，需先 unregister 再改。
 */
export function registerThirdParty(opts: {
  managedBy: string;
  /** 显式指定要登记的名字（不限前缀）；与 all 二选一。 */
  names?: string[];
  /** 按 scan 结果（前缀匹配 + 未登记）全量登记。 */
  all?: boolean;
  adapterId?: string;
}): RegisterThirdPartyResult {
  const manager = getManager(opts.managedBy);
  let targets: { name: string; adapterId: string }[];
  if (opts.all) {
    if (opts.names?.length) throw new Error("--names 与 --all 只能二选一");
    targets = scanThirdParty()
      .filter((c) => c.managedBy === manager.id)
      .filter((c) => !opts.adapterId || c.adapterId === opts.adapterId)
      .map((c) => ({ name: c.name, adapterId: c.adapterId }));
  } else {
    if (!opts.names?.length) throw new Error("缺少 --names 或 --all");
    targets = opts.names.map((name) => ({
      name,
      adapterId: opts.adapterId ?? "",
    }));
  }

  const registered: ThirdPartyEntryView[] = [];
  const skipped: { name: string; reason: string }[] = [];
  updateRegistry((reg) => {
    for (const { name, adapterId } of targets) {
      const prev = reg.thirdParty[name];
      if (prev) {
        skipped.push({
          name,
          reason:
            prev.managedBy === manager.id
              ? "已登记"
              : `已登记为托管方 ${prev.managedBy}（如需变更请先 unregister）`,
        });
        continue;
      }
      let resolved = adapterId;
      try {
        resolved = locateAdapter(name, opts.adapterId);
      } catch (err) {
        skipped.push({ name, reason: (err as Error).message });
        continue;
      }
      const entry: ThirdPartyEntry = {
        adapterId: resolved,
        managedBy: manager.id,
        category: manager.label,
        registeredAt: new Date().toISOString(),
      };
      reg.thirdParty[name] = entry;
      registered.push(toView(name, entry));
    }
  });
  if (registered.length > 0)
    recordEvent("thirdparty-register", undefined, {
      names: registered.map((r) => r.name),
      managedBy: manager.id,
    });
  return { registered, skipped };
}

/** 移除登记：只删 registry 条目，磁盘目录原样保留。 */
export function unregisterThirdParty(names: string[]): {
  removed: string[];
  missing: string[];
} {
  const removed: string[] = [];
  const missing: string[] = [];
  updateRegistry((reg) => {
    for (const name of names) {
      if (reg.thirdParty[name]) {
        delete reg.thirdParty[name];
        removed.push(name);
      } else {
        missing.push(name);
      }
    }
  });
  if (removed.length > 0) recordEvent("thirdparty-unregister", undefined, { names: removed });
  return { removed, missing };
}

export interface ManagerVersionInfo {
  /** best-effort 本地探测的当前版本；探测失败为 null（UI 显示未知）。 */
  current: string | null;
  /** 平台不做联网探测，恒为 null；用 manager.upgrade.versionHint 自查。 */
  latest: string | null;
}

/** best-effort 探测托管方当前版本：只跑本地命令、限时、任何失败都返回 null，绝不抛错。 */
export function probeManagerVersion(managedBy: string): ManagerVersionInfo {
  const m = getManager(managedBy);
  if (!m.versionProbe) return { current: null, latest: null };
  try {
    // Windows 上 npm 全局命令是 .cmd shim，spawnSync 无法直接执行，须经 shell 启动；
    // shell 模式下拼成单条命令，避免 args 拼接的 DEP0190 告警（此处命令与参数均为固定常量）
    const res = spawnSync(
      process.platform === "win32"
        ? [m.versionProbe.cmd, ...m.versionProbe.args].join(" ")
        : m.versionProbe.cmd,
      process.platform === "win32" ? [] : m.versionProbe.args,
      {
        timeout: m.versionProbe.timeoutMs ?? 8000,
        windowsHide: true,
        shell: process.platform === "win32",
        encoding: "utf8",
      },
    );
    const text = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    const found = text.match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/);
    return { current: found ? found[1]! : null, latest: null };
  } catch {
    return { current: null, latest: null };
  }
}

export function probeManagerVersions(): Record<string, ManagerVersionInfo> {
  return Object.fromEntries(THIRD_PARTY_MANAGERS.map((m) => [m.id, probeManagerVersion(m.id)]));
}
