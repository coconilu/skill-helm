import fs from "node:fs";
import path from "node:path";
import { ensureStore, paths } from "./store";

/** 从当前文件位置向上查找仓库内的资产目录（concepts/、meta-skill/ 等）。 */
export function findUpwards(dirName: string): string | null {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, dirName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 把仓库 concepts/ 同步到库存；仓库是概念注册表的权威源，覆盖式同步。 */
export function syncConcepts(): { synced: string[] } {
  const src = findUpwards("concepts");
  if (!src) throw new Error("未找到仓库 concepts/ 目录；请从仓库克隆内执行，或检查安装方式");
  ensureStore();
  const files = fs.readdirSync(src).filter((f) => f.endsWith(".md"));
  for (const f of files) fs.copyFileSync(path.join(src, f), path.join(paths.concepts(), f));
  return { synced: files };
}

export function listConcepts(): { name: string; title: string }[] {
  ensureStore();
  const localFiles = () => fs.readdirSync(paths.concepts()).filter((f) => f.endsWith(".md"));
  if (localFiles().length === 0) {
    try {
      syncConcepts();
    } catch {
      /* 仓库不可用则保留空列表 */
    }
  }
  return localFiles().map((f) => {
    const content = fs.readFileSync(path.join(paths.concepts(), f), "utf8");
    const title = (content.match(/^#\s+(.+)$/m)?.[1] ?? "").trim();
    return { name: f.replace(/\.md$/, ""), title };
  });
}

export function showConcept(name: string): string {
  const file = path.join(paths.concepts(), `${name}.md`);
  if (!fs.existsSync(file)) throw new Error(`未知概念主题: ${name}（可用 concepts list 查看全部）`);
  return fs.readFileSync(file, "utf8");
}
