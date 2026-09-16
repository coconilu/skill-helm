import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { DoctorIssue, Meta } from "./types";
import SkillsTab from "./SkillsTab";
import MarketTab from "./MarketTab";
import HistoryTab from "./HistoryTab";
import AboutPanel from "./AboutPanel";
import { dismiss, install, shouldShowToast, startPolling, useUpdates } from "./updates";

type Tab = "skills" | "market" | "history";

export default function App() {
  const [tab, setTab] = useState<Tab>("skills");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [doctorIssues, setDoctorIssues] = useState<DoctorIssue[]>([]);
  const [fatal, setFatal] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const updates = useUpdates();

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey 为刻意多带的依赖，用作刷新触发器，effect 本身不消费
  useEffect(() => {
    api
      .meta()
      .then(setMeta)
      .catch((e: Error) => setFatal(e.message));
    api
      .doctor()
      .then((r) => setDoctorIssues(r.issues))
      .catch(() => setDoctorIssues([]));
  }, [refreshKey]);

  // 应用级更新轮询：启动一次，此后每 30 分钟；状态在 updates 模块共享
  useEffect(() => startPolling(), []);

  const showToast = shouldShowToast(updates);
  const installBusy =
    updates.installStatus === "downloading" || updates.installStatus === "installing";

  if (fatal) {
    return (
      <div className="fatal">
        <h2>无法连接 Skill Helm API</h2>
        <p>{fatal}</p>
        <p>
          请确认已通过 Tauri 启动，或先运行 <code>skill-helm serve</code> 并以 VITE_API_ORIGIN
          调试。
        </p>
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
              {t === "skills" ? "技能" : t === "market" ? "市场" : t === "history" ? "历史" : t}
            </button>
          ))}
        </nav>
        <button className="refresh-btn" title="刷新数据" onClick={refresh}>
          ⟳ 刷新
        </button>
        {doctorIssues.length > 0 && (
          <span className="doctor-badge" title={doctorIssues.map((i) => i.message).join("\n")}>
            ⚠ {doctorIssues.length} 项待处理
          </span>
        )}
        <button className="about-btn" title="关于 Skill Helm" onClick={() => setAboutOpen(true)}>
          关于
        </button>
      </header>
      <main className={tab}>
        {tab === "skills" && <SkillsTab meta={meta} refresh={refresh} refreshKey={refreshKey} />}
        {tab === "market" && <MarketTab refresh={refresh} />}
        {tab === "history" && <HistoryTab refreshKey={refreshKey} />}
      </main>
      {showToast && updates.availableVersion && (
        <div className="update-toast" role="status">
          <div className="update-toast-text">
            发现新版本 <b className="mono">v{updates.availableVersion}</b>
            {updates.currentVersion && (
              <span className="update-toast-sub">当前 v{updates.currentVersion}</span>
            )}
            {updates.installStatus === "downloading" && (
              <div className="update-toast-sub">正在下载更新…</div>
            )}
            {updates.installStatus === "installing" && (
              <div className="update-toast-sub">正在安装更新…</div>
            )}
            {updates.installStatus === "error" && (
              <div className="update-toast-sub error">更新失败，可从「关于」重试</div>
            )}
          </div>
          {updates.installStatus !== "error" && (
            <button
              type="button"
              className="primary"
              onClick={() => void install()}
              disabled={installBusy}
            >
              立即更新
            </button>
          )}
          <button
            type="button"
            className="update-toast-close"
            aria-label={`关闭 v${updates.availableVersion} 更新提示`}
            title="关闭提示（同版本不再弹出）"
            onClick={dismiss}
          >
            ×
          </button>
        </div>
      )}
      {aboutOpen && <AboutPanel onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
