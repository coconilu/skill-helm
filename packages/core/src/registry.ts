import fs from "node:fs";
import { ensureStore, paths } from "./store";
import type { Registry } from "./types";

export const REGISTRY_VERSION = 1;

const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 30000;

export function emptyRegistry(): Registry {
  return { version: REGISTRY_VERSION, skills: {}, categories: {}, groups: {} };
}

export function loadRegistry(): Registry {
  ensureStore();
  const file = paths.registry();
  if (!fs.existsSync(file)) return emptyRegistry();
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Registry;
  parsed.skills ??= {};
  parsed.categories ??= {};
  parsed.groups ??= {};
  return parsed;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 简易文件锁：lock 文件 + 超时 + 陈旧锁清理。多 Agent 会话并发时保证 registry 读写串行。 */
function acquireLock(): () => void {
  ensureStore();
  const lock = paths.lock();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lock, "wx");
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => {
        try {
          fs.rmSync(lock, { force: true });
        } catch {
          /* 锁释放失败不致命 */
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(lock, { force: true });
          continue;
        }
      } catch {
        /* stat 失败说明锁已被释放，直接重试 */
        continue;
      }
      if (Date.now() > deadline) throw new Error("registry 锁等待超时，请检查是否有其他 skill-helm 进程卡住");
      sleepSync(50);
    }
  }
}

function writeAtomic(reg: Registry): void {
  fs.writeFileSync(paths.registryTmp(), JSON.stringify(reg, null, 2) + "\n", "utf8");
  fs.renameSync(paths.registryTmp(), paths.registry());
}

/** 读-改-写原子完成：持锁期间 load + mutate + 落盘，避免并发丢更新。 */
export function updateRegistry(mutate: (reg: Registry) => void): Registry {
  const release = acquireLock();
  try {
    const reg = loadRegistry();
    mutate(reg);
    writeAtomic(reg);
    return reg;
  } finally {
    release();
  }
}
