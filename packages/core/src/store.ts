import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 统一库存根目录。SKILL_HELM_HOME 仅供测试与高级用户覆盖；运行时逐次读取，便于测试切换。 */
export function storeHome(): string {
  const env = process.env.SKILL_HELM_HOME;
  if (env) return path.resolve(env);
  return path.join(os.homedir(), ".skill-helm");
}

export const paths = {
  home: () => storeHome(),
  skills: () => path.join(storeHome(), "skills"),
  registry: () => path.join(storeHome(), "registry.json"),
  registryTmp: () => path.join(storeHome(), "registry.json.tmp"),
  lock: () => path.join(storeHome(), "registry.lock"),
  concepts: () => path.join(storeHome(), "concepts"),
  adapters: () => path.join(storeHome(), "adapters"),
};

export function skillDir(name: string): string {
  return path.join(paths.skills(), name);
}

export function ensureStore(): void {
  for (const d of [paths.home(), paths.skills(), paths.concepts(), paths.adapters()]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
