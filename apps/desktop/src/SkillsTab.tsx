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
  const [filter, setFilter] = useState<SkillFilter>({});
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [notice, setNotice] = useState("");
  const [adoptPath, setAdoptPath] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editCats, setEditCats] = useState("");
  const [editGroups, setEditGroups] = useState("");

  const load = useCallback(() => {
    api.skills(filter).then(setSkills).catch((e: Error) => setNotice(e.message));
  }, [filter]);

  useEffect(load, [load, refreshKey]);

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

  const csv = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);
  const categories = [...new Set(skills.flatMap((s) => s.categories))];
  const groups = [...new Set(skills.flatMap((s) => s.groups))];

  return (
    <div className="page">
      <div className="toolbar">
        <select value={filter.category ?? ""} onChange={(e) => setFilter({ ...filter, category: e.target.value || undefined })}>
          <option value="">全部分类</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={filter.group ?? ""} onChange={(e) => setFilter({ ...filter, group: e.target.value || undefined })}>
          <option value="">全部分组</option>
          {groups.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <select value={filter.status ?? ""} onChange={(e) => setFilter({ ...filter, status: e.target.value || undefined })}>
          <option value="">全部状态</option>
          <option value="enabled">启用</option>
          <option value="disabled">禁用</option>
        </select>
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
      {notice && <div className="toast">{notice}</div>}
      <table className="grid">
        <thead>
          <tr>
            <th>名称</th>
            <th>描述</th>
            <th>分类</th>
            <th>分组</th>
            <th>启用于</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((s) => (
            <tr key={s.name} onClick={() => openDetail(s.name)} className={detail?.summary.name === s.name ? "selected" : ""}>
              <td className="mono">
                {s.name}
                <button className="copy-btn" title="复制名称" onClick={(e) => { e.stopPropagation(); copyName(s.name); }}>⧉</button>
              </td>
              <td className="desc" title={s.description}>{s.description || "-"}</td>
              <td>{s.categories.join(", ") || "-"}</td>
              <td>{s.groups.join(", ") || "-"}</td>
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
