import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { DoctorIssue, Meta } from "./types";
import SkillsTab from "./SkillsTab";
import MarketTab from "./MarketTab";
import HistoryTab from "./HistoryTab";

type Tab = "skills" | "market" | "history";

export default function App() {
  const [tab, setTab] = useState<Tab>("skills");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [doctorIssues, setDoctorIssues] = useState<DoctorIssue[]>([]);
  const [fatal, setFatal] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    api.meta().then(setMeta).catch((e: Error) => setFatal(e.message));
    api.doctor().then((r) => setDoctorIssues(r.issues)).catch(() => setDoctorIssues([]));
  }, [refreshKey]);

  if (fatal) {
    return (
      <div className="fatal">
        <h2>无法连接 Skill Helm API</h2>
        <p>{fatal}</p>
        <p>请确认已通过 Tauri 启动，或先运行 <code>skill-helm serve</code> 并以 VITE_API_ORIGIN 调试。</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">舵</span>
          <span className="title">Skill Helm</span>
          {meta && <span className="store">{meta.store}</span>}
        </div>
        <nav className="tabs">
          {(["skills", "market", "history"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
              {t === "skills" ? "技能" : t === "market" ? "市场" : "历史"}
            </button>
          ))}
        </nav>
        <button className="refresh-btn" title="刷新数据" onClick={refresh}>⟳ 刷新</button>
        {doctorIssues.length > 0 && (
          <span className="doctor-badge" title={doctorIssues.map((i) => i.message).join("\n")}>
            ⚠ {doctorIssues.length} 项待处理
          </span>
        )}
      </header>
      <main>
        {tab === "skills" && <SkillsTab meta={meta} refresh={refresh} refreshKey={refreshKey} />}
        {tab === "market" && <MarketTab refresh={refresh} />}
        {tab === "history" && <HistoryTab refreshKey={refreshKey} />}
      </main>
    </div>
  );
}
