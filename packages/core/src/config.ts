import fs from "node:fs";
import path from "node:path";
import { ensureStore, paths } from "./store";

export interface StoreConfig {
  /** 可选历史项目目录（持久化接口，见 docs 与 issue #1）；未配置时平台无持久化依赖。 */
  history?: { path: string };
}

function configFile(): string {
  return path.join(paths.home(), "config.json");
}

export function loadConfig(): StoreConfig {
  ensureStore();
  const file = configFile();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as StoreConfig;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: StoreConfig): void {
  ensureStore();
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}
