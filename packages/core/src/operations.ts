import fs from "node:fs";
import path from "node:path";
import { detectOwnerAdapter, getAdapter, loadAdapters } from "./adapters";
import { findUpwards, syncConcepts } from "./concepts";
import { parseSkillMd, serializeSkillMd } from "./frontmatter";
import { lintDir } from "./lint";
import { createLink, inspectLink, linkPathFor, removeLink } from "./links";
import { loadRegistry, updateRegistry } from "./registry";
import { assertValidName, createSkillPackage, readSkillInfo } from "./skills";
import { ensureStore, paths, skillDir } from "./store";
import type { DoctorIssue, LintIssue, SkillMeta, SkillSummary, TargetResult } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function defaultMeta(): SkillMeta {
  return { enabledIn: [], categories: [], groups: [], tags: [], source: "local", createdAt: nowIso(), updatedAt: nowIso() };
}

/** 从磁盘实际联接状态重算启用列表，让 registry 始终跟随事实。 */
function actualEnabledIn(name: string, target: string): string[] {
  return loadAdapters()
    .filter((a) => inspectLink(linkPathFor(a, name), target) === "ok")
    .map((a) => a.id);
}

function ensureTaxonomy(reg: { categories: Record<string, object>; groups: Record<string, object> }, categories: string[], groups: string[]): void {
  for (const c of categories) reg.categories[c] ??= {};
  for (const g of groups) reg.groups[g] ??= {};
}

function toSummary(name: string, meta: SkillMeta | undefined, registered: boolean): SkillSummary {
  const dir = skillDir(name);
  const info = readSkillInfo(dir);
  const links = loadAdapters().map((a) => ({
    adapter: a.id,
    path: linkPathFor(a, name),
    state: inspectLink(linkPathFor(a, name), dir),
  }));
  const enabledIn = links.filter((l) => l.state === "ok").map((l) => l.adapter);
  const base = meta ?? defaultMeta();
  return {
    ...base,
    enabledIn,
    name,
    description: info?.description ?? "",
    status: enabledIn.length > 0 ? "enabled" : "disabled",
    registered,
    links,
  };
}

export interface ListFilter {
  category?: string;
  group?: string;
  status?: "enabled" | "disabled";
}

export function listSkills(filter: ListFilter = {}): SkillSummary[] {
  const reg = loadRegistry();
  const names = new Set(Object.keys(reg.skills));
  if (fs.existsSync(paths.skills())) {
    for (const d of fs.readdirSync(paths.skills())) {
      if (fs.statSync(skillDir(d)).isDirectory()) names.add(d);
    }
  }
  let out = [...names].sort().map((n) => toSummary(n, reg.skills[n], Boolean(reg.skills[n])));
  if (filter.category) out = out.filter((s) => s.categories.includes(filter.category!));
  if (filter.group) out = out.filter((s) => s.groups.includes(filter.group!));
  if (filter.status) out = out.filter((s) => s.status === filter.status);
  return out;
}

export function getSkill(name: string): { summary: SkillSummary; issues: LintIssue[] } {
  const reg = loadRegistry();
  const dirExists = fs.existsSync(skillDir(name));
  if (!reg.skills[name] && !dirExists) throw new Error(`Skill 不存在: ${name}`);
  const summary = toSummary(name, reg.skills[name], Boolean(reg.skills[name]));
  const issues = dirExists ? lintDir(skillDir(name), name) : [];
  return { summary, issues };
}

export interface SkillInput {
  name: string;
  description: string;
  categories?: string[];
  groups?: string[];
  tags?: string[];
}

export function createSkill(input: SkillInput): SkillSummary {
  createSkillPackage(input.name, input.description);
  updateRegistry((reg) => {
    reg.skills[input.name] = {
      ...defaultMeta(),
      categories: input.categories ?? [],
      groups: input.groups ?? [],
      tags: input.tags ?? [],
    };
    ensureTaxonomy(reg, input.categories ?? [], input.groups ?? []);
  });
  return getSkill(input.name).summary;
}

export function updateSkill(name: string, patch: Partial<Omit<SkillInput, "name">>): SkillSummary {
  const reg = loadRegistry();
  const dir = skillDir(name);
  if (!reg.skills[name] && !fs.existsSync(dir)) throw new Error(`Skill 不存在: ${name}`);
  if (patch.description !== undefined) {
    const file = path.join(dir, "SKILL.md");
    if (!fs.existsSync(file)) throw new Error(`${name} 缺少 SKILL.md，无法更新描述`);
    const { data, body } = parseSkillMd(fs.readFileSync(file, "utf8"));
    data.description = patch.description;
    fs.writeFileSync(file, serializeSkillMd(data, body), "utf8");
  }
  updateRegistry((r) => {
    const m = (r.skills[name] ??= defaultMeta());
    if (patch.categories) m.categories = patch.categories;
    if (patch.groups) m.groups = patch.groups;
    if (patch.tags) m.tags = patch.tags;
    m.updatedAt = nowIso();
    ensureTaxonomy(r, m.categories, m.groups);
  });
  return getSkill(name).summary;
}

export interface AdoptResult {
  summary: SkillSummary;
  /** 其他 agent 目录下同名真实目录——未动它们，需人工确认后再处理。 */
  conflicts: { adapter: string; path: string }[];
}

export function adoptSkill(srcPath: string, opts: { name?: string; from?: string } = {}): AdoptResult {
  const src = path.resolve(srcPath);
  if (!fs.existsSync(src)) throw new Error(`路径不存在: ${src}`);
  const info = readSkillInfo(src);
  if (!info) throw new Error(`${src} 缺少 SKILL.md，不是一个 Skill 目录`);
  const name = opts.name ?? (info.name || path.basename(src));
  assertValidName(name);
  const target = skillDir(name);
  if (fs.existsSync(target)) throw new Error(`库存中已存在 Skill: ${name}`);
  if (loadRegistry().skills[name]) throw new Error(`注册表中已存在 Skill: ${name}`);

  const owner = opts.from ? getAdapter(opts.from) : detectOwnerAdapter(path.dirname(src));
  const conflicts = loadAdapters()
    .filter((a) => !owner || a.id !== owner.id)
    .map((a) => ({ adapter: a.id, path: linkPathFor(a, name) }))
    .filter((c) => inspectLink(c.path, target) === "conflict");

  ensureStore();
  try {
    fs.renameSync(src, target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    fs.cpSync(src, target, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
  if (owner) createLink(target, linkPathFor(owner, name));
  updateRegistry((reg) => {
    reg.skills[name] = { ...defaultMeta(), source: "adopted", enabledIn: actualEnabledIn(name, target) };
  });
  return { summary: getSkill(name).summary, conflicts };
}

export function enableSkill(name: string, adapterIds: string[]): { results: TargetResult[] } {
  const target = skillDir(name);
  if (!fs.existsSync(target)) throw new Error(`库存中不存在 Skill: ${name}（可先 create 或 adopt）`);
  const results: TargetResult[] = adapterIds.map((id) => {
    const a = getAdapter(id);
    const lp = linkPathFor(a, name);
    const state = inspectLink(lp, target);
    if (state === "ok") return { adapter: id, state: "already" };
    if (state === "conflict") return { adapter: id, state: "error", message: `${lp} 已被真实目录占用，可先 adopt 收编` };
    if (state === "foreign") return { adapter: id, state: "error", message: `${lp} 是指向别处的联接，请人工处理` };
    try {
      if (state === "broken") fs.rmSync(lp, { force: true });
      createLink(target, lp);
      return { adapter: id, state: "ok" };
    } catch (err) {
      return { adapter: id, state: "error", message: (err as Error).message };
    }
  });
  updateRegistry((reg) => {
    const m = (reg.skills[name] ??= defaultMeta());
    m.enabledIn = actualEnabledIn(name, target);
    m.updatedAt = nowIso();
  });
  return { results };
}

export function disableSkill(name: string, adapterIds: string[]): { results: TargetResult[] } {
  const target = skillDir(name);
  const results: TargetResult[] = adapterIds.map((id) => {
    const a = getAdapter(id);
    const lp = linkPathFor(a, name);
    const state = inspectLink(lp, target);
    if (state === "missing") return { adapter: id, state: "already" };
    if (state === "conflict") return { adapter: id, state: "error", message: `${lp} 是真实目录而非联接，未动它` };
    if (state === "foreign") return { adapter: id, state: "error", message: `${lp} 指向别处，未动它` };
    try {
      removeLink(lp);
      return { adapter: id, state: "ok" };
    } catch (err) {
      return { adapter: id, state: "error", message: (err as Error).message };
    }
  });
  if (fs.existsSync(target)) {
    updateRegistry((reg) => {
      const m = (reg.skills[name] ??= defaultMeta());
      m.enabledIn = actualEnabledIn(name, target);
      m.updatedAt = nowIso();
    });
  }
  return { results };
}

export function removeSkill(name: string): void {
  const dir = skillDir(name);
  const dirExists = fs.existsSync(dir);
  if (!dirExists) {
    updateRegistry((reg) => {
      delete reg.skills[name];
    });
    return;
  }
  const active = loadAdapters().filter((a) => inspectLink(linkPathFor(a, name), dir) === "ok").map((a) => a.id);
  if (active.length > 0) {
    throw new Error(`请先禁用再删除（当前启用于: ${active.join(", ")}）`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  updateRegistry((reg) => {
    delete reg.skills[name];
  });
}

export function doctor(fix: boolean): DoctorIssue[] {
  const issues: DoctorIssue[] = [];
  const adapters = loadAdapters();
  const reg = loadRegistry();

  for (const name of Object.keys(reg.skills)) {
    if (!fs.existsSync(skillDir(name))) {
      issues.push({ type: "registry-missing-dir", name, message: `注册表有记录但库存目录缺失: ${name}`, fixed: fix });
      if (fix) updateRegistry((r) => {
        delete r.skills[name];
      });
    }
  }

  if (fs.existsSync(paths.skills())) {
    const regNow = loadRegistry();
    for (const d of fs.readdirSync(paths.skills())) {
      if (!fs.statSync(skillDir(d)).isDirectory() || regNow.skills[d]) continue;
      issues.push({ type: "unregistered", name: d, message: `库存目录未登记: ${d}`, fixed: fix });
      if (fix) {
        updateRegistry((r) => {
          r.skills[d] = { ...defaultMeta(), enabledIn: actualEnabledIn(d, skillDir(d)) };
        });
      }
    }
  }

  for (const [name, meta] of Object.entries(loadRegistry().skills)) {
    const dir = skillDir(name);
    if (!fs.existsSync(dir)) continue;
    const actual = actualEnabledIn(name, dir);
    const same = [...actual].sort().join(",") === [...meta.enabledIn].sort().join(",");
    if (same) continue;
    let fixedAll = true;
    if (fix) {
      for (const id of meta.enabledIn.filter((x) => !actual.includes(x))) {
        const a = adapters.find((x) => x.id === id);
        if (!a) continue;
        const lp = linkPathFor(a, name);
        const st = inspectLink(lp, dir);
        try {
          if (st === "broken") fs.rmSync(lp, { force: true });
          if (st === "missing" || st === "broken") createLink(dir, lp);
          else fixedAll = false;
        } catch {
          fixedAll = false;
        }
      }
      updateRegistry((r) => {
        const m = r.skills[name];
        if (m) m.enabledIn = actualEnabledIn(name, dir);
      });
    }
    issues.push({
      type: "link-drift",
      name,
      message: `启用状态漂移: registry=[${meta.enabledIn.join(",")}] 实际=[${actual.join(",")}]`,
      fixed: fix && fixedAll,
    });
  }

  const regFinal = loadRegistry();
  for (const a of adapters) {
    if (!fs.existsSync(a.skillsDir)) continue;
    for (const d of fs.readdirSync(a.skillsDir)) {
      if (d.startsWith(".")) continue;
      const p = path.join(a.skillsDir, d);
      const lst = fs.lstatSync(p);
      if (!lst.isDirectory() || lst.isSymbolicLink() || regFinal.skills[d]) continue;
      issues.push({ type: "unmanaged", name: d, adapter: a.id, message: `${a.id} 下存在未收编 Skill: ${d}（可用 adopt 收编）`, fixed: false });
    }
  }
  return issues;
}

/** 自举：同步概念注册表 + 把仓库 meta-skill 安装进库存并启用到所有已知 agent。 */
export function initPlatform(): { concepts: string[]; enableResults: TargetResult[] } {
  ensureStore();
  let concepts: string[] = [];
  try {
    concepts = syncConcepts().synced;
  } catch {
    /* 仓库外运行时跳过，concepts list 会再尝试 */
  }
  const src = findUpwards("meta-skill");
  if (!src) throw new Error("未找到仓库 meta-skill/ 目录；请从仓库克隆内执行 init");
  const dir = skillDir("skill-helm");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(src, dir, { recursive: true });
  updateRegistry((reg) => {
    const m = (reg.skills["skill-helm"] ??= defaultMeta());
    m.source = "repo";
    m.updatedAt = nowIso();
  });
  const { results } = enableSkill("skill-helm", loadAdapters().map((a) => a.id));
  return { concepts, enableResults: results };
}
