import { useCallback, useEffect, useState } from "react";
import { api, type SkillFilter } from "./api";
import type { Meta, SkillDetail, SkillSummary } from "./types";

interface Props {
  meta: Meta | null;
  refresh: () => void;
  refreshKey: number;
}

export default function SkillsTab({ meta, refresh, refreshKey }: Props) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [catalog, setCatalog] = useState<SkillSummary[]>([]);
  const [filter, setFilter] = useState<SkillFilter>({});
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [notice, setNotice] = useState("");
  const [adoptPath, setAdoptPath] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editCats, setEditCats] = useState("");
  const [editGroups, setEditGroups] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newGroup, setNewGroup] = useState("");

  const load = useCallback(() => {
    api.skills(filter).then(setSkills).catch((e: Error) => setNotice(e.message));
  }, [filter]);

  // 未过滤的全量列表：用于派生分类/分组及其计数，不随过滤条件收缩
  const loadCatalog = useCallback(() => {
    api.skills({}).then(setCatalog).catch(() => {});
  }, []);

  useEffect(load, [load, refreshKey]);
  useEffect(loadCatalog, [loadCatalog, refreshKey]);

  /** 更新过滤条件，同时清空批量选择，避免选中项被过滤隐藏后误操作。 */
  const updateFilter = (f: SkillFilter) => {
    setFilter(f);
    setSelected(new Set());
  };

  const tell = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 6000);
  };

  const copyName = async (name: string) => {
    try {
      await api.copy(name);
      tell(`已复制：${name}`);
    } catch (e) {
      tell(`复制失败：${(e as Error).message}`);
    }
  };

  const reload = () => {
    load();
    loadCatalog();
    refresh();
  };

  /** 与某适配器目录重叠（会被同一批 agent 读到）的其他适配器 id。 */
  const overlaps = (adapter: string): string[] => {
    const cfgs = meta?.adapters ?? [];
    const me = cfgs.find((c) => c.id === adapter);
    const coveredByMe = me?.covers ?? [];
    const coveringMe = cfgs.filter((c) => c.covers.includes(adapter)).map((c) => c.id);
    return [...coveredByMe, ...coveringMe];
  };

  const toggle = async (name: string, adapter: string, enabled: boolean, enabledIn: string[]) => {
    try {
      if (enabled) {
        const r = await api.disable(name, [adapter]);
        const err = r.results.find((x) => x.state === "error");
        if (err) tell(`${adapter}: ${err.message}`);
      } else {
        const r = await api.enable(name, [adapter]);
        const err = r.results.find((x) => x.state === "error");
        if (err) tell(`${adapter}: ${err.message}`);
        // 互斥：目录重叠的适配器同时启用会产生同名重复，自动关闭
        const off = enabledIn.filter((x) => x !== adapter && overlaps(adapter).includes(x));
        if (off.length > 0) {
          await api.disable(name, off);
          tell(`已自动关闭「${off.join("、")}」：与「${adapter}」效果相同，无需同时开启`);
        }
      }
      reload();
    } catch (e) {
      tell((e as Error).message);
    }
  };

  const openDetail = async (name: string) => {
    try {
      const d = await api.getSkill(name);
      setDetail(d);
      setEditDesc(d.summary.description);
      setEditCats(d.summary.categories.join(", "));
      setEditGroups(d.summary.groups.join(", "));
    } catch (e) {
      tell((e as Error).message);
    }
  };

  const saveDetail = async () => {
    if (!detail) return;
    try {
      await api.update(detail.summary.name, {
        description: editDesc,
        categories: editCats.split(",").map((s) => s.trim()).filter(Boolean),
        groups: editGroups.split(",").map((s) => s.trim()).filter(Boolean),
      });
      tell("已保存");
      await openDetail(detail.summary.name);
      reload();
    } catch (e) {
      tell((e as Error).message);
    }
  };

  const removeSkill = async () => {
    if (!detail) return;
    if (!window.confirm(`确定删除 ${detail.summary.name}？文件将从库存移除（需先全部禁用）。`)) return;
    try {
      await api.remove(detail.summary.name);
      setDetail(null);
      reload();
    } catch (e) {
      tell((e as Error).message);
    }
  };

  const openSkill = async (target: "folder" | "code") => {
    if (!detail) return;
    try {
      await api.open(detail.summary.name, target);
    } catch (e) {
      tell((e as Error).message);
    }
  };

  const adopt = async () => {
    if (!adoptPath.trim()) return;
    try {
      const r = await api.adopt(adoptPath.trim());
      tell(`已收编 ${r.summary.name}${r.conflicts.length ? `；但 ${r.conflicts.map((c) => c.adapter).join("、")} 下已存在同名目录，请手动处理` : ""}`);
      setAdoptPath("");
      reload();
    } catch (e) {
      tell((e as Error).message);
    }
  };

  const allVisibleSelected = skills.length > 0 && skills.every((s) => selected.has(s.name));

  const toggleAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(skills.map((s) => s.name)));
  };

  const toggleOne = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };

  /** 批量把选中技能加入/移出某分组。 */
  const applyGroup = async (group: string, mode: "add" | "remove") => {
    const targets = catalog.filter((s) => selected.has(s.name));
    if (targets.length === 0) return;
    try {
      for (const t of targets) {
        const groups =
          mode === "add" ? [...new Set([...t.groups, group])] : t.groups.filter((g) => g !== group);
        await api.update(t.name, { groups });
      }
      tell(
        mode === "add"
          ? `已将 ${targets.length} 个技能加入「${group}」`
          : `已将 ${targets.length} 个技能移出「${group}」`
      );
      setSelected(new Set());
      reload();
    } catch (e) {
      tell((e as Error).message);
    }
  };

  const createGroup = async () => {
    const g = newGroup.trim();
    if (!g || selected.size === 0) return;
    await applyGroup(g, "add");
    setNewGroup("");
  };

  const categories = [...new Set(catalog.flatMap((s) => s.categories))];
  const groups = [...new Set(catalog.flatMap((s) => s.groups))];
  const groupCount = (g: string) => catalog.filter((s) => s.groups.includes(g)).length;
  const statusCount = (st: "enabled" | "disabled") => catalog.filter((s) => s.status === st).length;
  const activeGroup = filter.group;
  const activeStatus = filter.status;

  return (
    <div className="page">
      <div className="toolbar">
        <span className="spacer" />
        <input
          className="adopt-input"
          placeholder="收编路径，如 ~/.codex/skills/xxx"
          value={adoptPath}
          onChange={(e) => setAdoptPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && adopt()}
        />
        <button onClick={adopt}>收编</button>
      </div>
      <div className="cat-chips">
        <button className={!filter.category ? "chip on" : "chip"} onClick={() => updateFilter({ ...filter, category: undefined })}>
          全部
        </button>
        {categories.map((c) => (
          <button key={c} className={filter.category === c ? "chip on" : "chip"} onClick={() => updateFilter({ ...filter, category: c })}>
            {c}
          </button>
        ))}
      </div>
      {notice && <div className="toast">{notice}</div>}
      <div className="skills-layout">
        <div className="skills-main">
          <table className="grid">
            <thead>
              <tr>
                <th className="check">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} title="全选" />
                </th>
                <th>名称</th>
                <th>描述</th>
                <th>分类</th>
                <th>启用于</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((s) => (
                <tr key={s.name} onClick={() => openDetail(s.name)} className={detail?.summary.name === s.name ? "selected" : ""}>
                  <td className="check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(s.name)} onChange={() => toggleOne(s.name)} />
                  </td>
                  <td className="mono">
                    {s.name}
                    <button className="copy-btn" title="复制名称" onClick={(e) => { e.stopPropagation(); copyName(s.name); }}>⧉</button>
                  </td>
                  <td className="desc" title={s.description}>{s.description || "-"}</td>
                  <td>{s.categories.join(", ") || "-"}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {(meta?.adapters ?? []).map((a) => {
                      const on = s.enabledIn.includes(a.id);
                      return (
                        <button key={a.id} className={on ? "chip on" : "chip"} title={on ? "点击禁用" : "点击启用"} onClick={() => toggle(s.name, a.id, on, s.enabledIn)}>
                          {a.id}
                        </button>
                      );
                    })}
                  </td>
                </tr>
              ))}
              {skills.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">暂无 Skill——用上方收编、市场安装，或让 Agent 创建一个</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <aside className="group-panel">
          <div className="panel-section">
            <div className="panel-title">状态</div>
            <button className={!activeStatus ? "group-item active" : "group-item"} onClick={() => updateFilter({ ...filter, status: undefined })}>
              <span className="group-name">全部</span>
              <span className="count">{catalog.length}</span>
            </button>
            <button className={activeStatus === "enabled" ? "group-item active" : "group-item"} onClick={() => updateFilter({ ...filter, status: "enabled" })}>
              <span className="group-name">启用</span>
              <span className="count">{statusCount("enabled")}</span>
            </button>
            <button className={activeStatus === "disabled" ? "group-item active" : "group-item"} onClick={() => updateFilter({ ...filter, status: "disabled" })}>
              <span className="group-name">禁用</span>
              <span className="count">{statusCount("disabled")}</span>
            </button>
          </div>
          <div className="panel-section">
            <div className="panel-title">分组</div>
            <button className={!activeGroup ? "group-item active" : "group-item"} onClick={() => updateFilter({ ...filter, group: undefined })}>
              <span className="group-name">全部</span>
              <span className="count">{catalog.length}</span>
            </button>
            {groups.map((g) => (
              <button key={g} className={activeGroup === g ? "group-item active" : "group-item"} onClick={() => updateFilter({ ...filter, group: g })}>
                <span className="group-name">{g}</span>
                <span className="count">{groupCount(g)}</span>
              </button>
            ))}
          </div>
          {selected.size > 0 && (
            <div className="batch-box">
              <div className="panel-title">已选 {selected.size} 项</div>
              {activeGroup && (
                <>
                  <button onClick={() => applyGroup(activeGroup, "add")}>加入「{activeGroup}」</button>
                  <button onClick={() => applyGroup(activeGroup, "remove")}>移出「{activeGroup}」</button>
                </>
              )}
              <input
                placeholder="新分组名"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createGroup()}
              />
              <button className="primary" disabled={!newGroup.trim()} onClick={createGroup}>
                新建分组并加入
              </button>
            </div>
          )}
        </aside>
      </div>

      {detail && (
        <div className="drawer-mask" onClick={() => setDetail(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <header>
              <h3 className="mono">
                {detail.summary.name}
                <button className="copy-btn" title="复制名称" onClick={() => copyName(detail.summary.name)}>⧉</button>
              </h3>
              <button className="close" onClick={() => setDetail(null)}>×</button>
            </header>
            <label>描述</label>
            <textarea className="desc-input" rows={7} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
            <label>分类（逗号分隔）</label>
            <input value={editCats} onChange={(e) => setEditCats(e.target.value)} />
            <label>分组（逗号分隔）</label>
            <input value={editGroups} onChange={(e) => setEditGroups(e.target.value)} />
            <div className="row">
              <button className="primary" onClick={saveDetail}>保存</button>
              <button className="danger" onClick={removeSkill}>删除</button>
            </div>
            <label>文件</label>
            <div className="row">
              <button onClick={() => openSkill("folder")}>打开目录</button>
              <button onClick={() => openSkill("code")}>VS Code 打开</button>
            </div>
            <label>启用状态</label>
            <div className="row">
              {(meta?.adapters ?? []).map((a) => {
                const on = detail.summary.enabledIn.includes(a.id);
                return (
                  <button key={a.id} className={on ? "chip on" : "chip"} onClick={async () => { await toggle(detail.summary.name, a.id, on, detail.summary.enabledIn); await openDetail(detail.summary.name); }}>
                    {a.id}
                  </button>
                );
              })}
            </div>
            <label>lint</label>
            {detail.issues.length === 0 ? (
              <p className="ok">✓ 通过</p>
            ) : (
              <ul className="issues">
                {detail.issues.map((i, idx) => (
                  <li key={idx} className={i.level}>[{i.level}] {i.message}</li>
                ))}
              </ul>
            )}
            <label>信息</label>
            <p className="meta-line">来源 {detail.summary.source} · 更新于 {detail.summary.updatedAt.slice(0, 19).replace("T", " ")}</p>
          </aside>
        </div>
      )}
    </div>
  );
}
