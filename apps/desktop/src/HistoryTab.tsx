import { useEffect, useState } from "react";
import { api } from "./api";
import type { HistoryEvent } from "./types";

export default function HistoryTab({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ enabled: boolean; path?: string; events: HistoryEvent[] } | null>(null);

  useEffect(() => {
    api.history().then(setData).catch(() => setData({ enabled: false, events: [] }));
  }, [refreshKey]);

  if (!data) return <div className="page">加载中…</div>;
  if (!data.enabled) {
    return (
      <div className="page">
        <div className="empty-card">
          <h3>历史记录未启用</h3>
          <p>这是可选功能：创建一个空项目来保存 Skill 的变更历史（create / update / enable / install 等事件）。</p>
          <p>在终端执行：<code>skill-helm history init &lt;空目录&gt;</code>，之后回到本页即可看到时间线。</p>
        </div>
      </div>
    );
  }
  return (
    <div className="page">
      <p className="meta-line">历史项目：{data.path}（共 {data.events.length} 条，按时间倒序）</p>
      <table className="grid">
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>对象</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          {data.events.map((e, i) => (
            <tr key={i}>
              <td className="mono">{e.time.slice(0, 19).replace("T", " ")}</td>
              <td>{e.type}</td>
              <td className="mono">{e.name ?? "-"}</td>
              <td className="desc">{e.detail ? JSON.stringify(e.detail) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
