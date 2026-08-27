import { useState } from "react";
import { api } from "./api";
import type { MarketCandidate, RepoSkill } from "./types";

export default function MarketTab({ refresh }: { refresh: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MarketCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [candidates, setCandidates] = useState<Record<string, RepoSkill[]>>({});

  const tell = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 6000);
  };

  const search = async () => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      setResults(await api.search(q.trim()));
    } catch (e) {
      tell((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const install = async (repo: string, skill?: string) => {
    try {
      const r = await api.install(repo, skill);
      if (r.candidates && r.candidates.length > 0) {
        setCandidates({ ...candidates, [repo]: r.candidates });
        return;
      }
      setCandidates({ ...candidates, [repo]: [] });
      tell(`已安装 ${r.installed.map((s) => s.name).join(", ")}（默认禁用，到「技能」页启用试用）`);
      refresh();
    } catch (e) {
      tell((e as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="toolbar">
        <input
          className="search-input"
          placeholder="用自然语言描述你要的能力，如：给视频加字幕"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button className="primary" onClick={search} disabled={loading}>{loading ? "搜索中…" : "搜索"}</button>
      </div>
      {notice && <div className="toast">{notice}</div>}
      <table className="grid">
        <thead>
          <tr>
            <th>仓库</th>
            <th>星数</th>
            <th>简介</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {results.map((c) => (
            <>
              <tr key={c.repo}>
                <td className="mono">{c.repo}</td>
                <td>{c.stars}</td>
                <td className="desc" title={c.description}>{c.description || "-"}</td>
                <td>
                  <button onClick={() => install(c.repo)}>安装</button>
                </td>
              </tr>
              {(candidates[c.repo]?.length ?? 0) > 0 && (
                <tr key={c.repo + "-candidates"} className="candidates">
                  <td colSpan={4}>
                    该仓库包含多个 Skill：
                    {candidates[c.repo].map((s) => (
                      <button key={s.name} className="chip" title={s.description} onClick={() => install(c.repo, s.name)}>
                        {s.name}
                      </button>
                    ))}
                    <button className="chip on" onClick={() => install(c.repo, "all")}>全部安装</button>
                  </td>
                </tr>
              )}
            </>
          ))}
          {results.length === 0 && !loading && (
            <tr>
              <td colSpan={4} className="empty">输入描述并搜索；安装后进库存、默认禁用，随时可清理</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
