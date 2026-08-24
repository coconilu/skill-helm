import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { paths } from "./store";
import type { AdapterConfig } from "./types";

/** 内置适配器：保持薄——只有 id 与 skills 目录，没有任何业务逻辑。 */
export const DEFAULT_ADAPTERS: AdapterConfig[] = [
  { id: "codex", skillsDir: "~/.codex/skills" },
  { id: "kimi-code", skillsDir: "~/.kimi-code/skills" },
  { id: "agents-shared", skillsDir: "~/.agents/skills" },
];

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

/**
 * 加载适配器：内置默认值 ← ~/.skill-helm/adapters/*.json（用户扩展/覆盖）。
 * 设置 SKILL_HELM_ADAPTERS_DIR 时只用该目录（测试隔离用）。
 */
export function loadAdapters(): AdapterConfig[] {
  const envDir = process.env.SKILL_HELM_ADAPTERS_DIR;
  const map = new Map<string, AdapterConfig>();
  if (!envDir) {
    for (const a of DEFAULT_ADAPTERS) map.set(a.id, { id: a.id, skillsDir: expandHome(a.skillsDir) });
  }
  const dirs = envDir ? [path.resolve(envDir)] : [paths.adapters()];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const cfg = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Partial<AdapterConfig>;
      if (cfg.id && cfg.skillsDir) map.set(cfg.id, { id: cfg.id, skillsDir: expandHome(cfg.skillsDir) });
    }
  }
  return [...map.values()];
}

export function getAdapter(id: string): AdapterConfig {
  const adapter = loadAdapters().find((a) => a.id === id);
  if (!adapter) {
    const known = loadAdapters().map((a) => a.id).join(", ");
    throw new Error(`未知 agent 适配器: ${id}（当前已知: ${known || "无"}）`);
  }
  return adapter;
}

/** 判断某个目录是否位于某 adapter 的 skills 目录下，是则返回该 adapter。 */
export function detectOwnerAdapter(dirPath: string): AdapterConfig | undefined {
  const normalized = path.resolve(dirPath).toLowerCase();
  return loadAdapters().find((a) => normalized === path.resolve(a.skillsDir).toLowerCase());
}
