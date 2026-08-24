import fs from "node:fs";
import path from "node:path";
import type { AdapterConfig, LinkState } from "./types";

/** Windows 路径比较：大小写不敏感、忽略尾部分隔符。 */
export function samePath(a: string, b: string): boolean {
  const norm = (s: string) => path.resolve(s).replace(/[\\/]+$/g, "").toLowerCase();
  return norm(a) === norm(b);
}

export function linkPathFor(adapter: AdapterConfig, name: string): string {
  return path.join(adapter.skillsDir, name);
}

/**
 * 检查启用位置的状态：
 * - ok：junction 存在且指向库存目标
 * - missing：没有任何东西
 * - conflict：被真实目录/文件占用（可能是未收编的 Skill）
 * - foreign：是联接但指向别处
 */
export function inspectLink(linkPath: string, target: string): LinkState {
  const lst = fs.lstatSync(linkPath, { throwIfNoEntry: false });
  if (!lst) return "missing";
  if (!lst.isSymbolicLink()) return "conflict";
  let actual: string;
  try {
    actual = fs.readlinkSync(linkPath);
  } catch {
    return "broken";
  }
  const resolved = path.resolve(path.dirname(linkPath), actual);
  return samePath(resolved, target) ? "ok" : "foreign";
}

/** 创建目录联接（Windows junction，普通用户权限即可）。 */
export function createLink(target: string, linkPath: string): void {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath, "junction");
}

/** 移除联接；只删联接本身，绝不动目标目录。目标是真实目录时拒绝操作。 */
export function removeLink(linkPath: string): boolean {
  const lst = fs.lstatSync(linkPath, { throwIfNoEntry: false });
  if (!lst) return false;
  if (!lst.isSymbolicLink()) {
    throw new Error(`拒绝删除非联接目录（可能是真实 Skill 目录）: ${linkPath}`);
  }
  fs.rmSync(linkPath);
  return true;
}
