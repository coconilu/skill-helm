import { useCallback, useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
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
  const [update, setUpdate] = useState<Update | null>(null);
  const [updateState, setUpdateState] = useState<"idle" | "busy" | "error">("idle");

  useEffect(() => {
    api.meta().then(setMeta).catch((e: Error) => setFatal(e.message));
    api.doctor().then((r) => setDoctorIssues(r.issues)).catch(() => setDoctorIssues([]));
  }, [refreshKey]);

  // 启动时检查一次，此后每 30 分钟轮询；离线或检查失败不打扰用户
  useEffect(() => {
    let cancelled = false;
    const run = () =>
      check()
        .then((u) => {
          if (!cancelled && u) setUpdate(u);
        })
        .catch(() => {});
    run();
    const timer = setInterval(run, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const installUpdate = useCallback(async () => {
    if (!update) return;
    setUpdateState("busy");
    try {
      // Windows NSIS：下载完成后安装器接管，自动关闭并重启到新版本
      await update.downloadAndInstall();
    } catch {
      setUpdateState("error");
    }
  }, [update]);

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
      <main className={tab}>
        {tab === "skills" && <SkillsTab meta={meta} refresh={refresh} refreshKey={refreshKey} />}
        {tab === "market" && <MarketTab refresh={refresh} />}
        {tab === "history" && <HistoryTab refreshKey={refreshKey} />}
      </main>
      {update && (
        <div className="update-toast">
          <div className="update-toast-text">
            发现新版本 <b>v{update.version}</b>（当前 v{update.currentVersion}）
            {updateState === "busy" && <div className="update-toast-sub">正在下载更新…</div>}
            {updateState === "error" && <div className="update-toast-sub error">下载失败，请重试</div>}
          </div>
          <button onClick={installUpdate} disabled={updateState === "busy"}>
            立即更新
          </button>
        </div>
      )}
    </div>
  );
}
