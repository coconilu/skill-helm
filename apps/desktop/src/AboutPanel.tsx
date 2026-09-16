import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { dismiss, install, runCheck, useUpdates } from "./updates";

interface Props {
  onClose: () => void;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export default function AboutPanel({ onClose }: Props) {
  const s = useUpdates();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);

  const loadVersion = useCallback(() => {
    setVersionError(null);
    getVersion()
      .then(setAppVersion)
      .catch((e: Error) => setVersionError(e.message));
  }, []);

  useEffect(() => {
    loadVersion();
  }, [loadVersion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const busy = s.installStatus === "downloading" || s.installStatus === "installing";
  const percent =
    s.totalBytes !== null && s.totalBytes > 0
      ? Math.min(100, Math.round((s.downloadedBytes / s.totalBytes) * 100))
      : null;

  return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <aside
        className="drawer about-drawer"
        role="dialog"
        aria-label="关于 Skill Helm"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h3>关于</h3>
          <button type="button" className="close" aria-label="关闭关于面板" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="about-row">
          <span className="about-label">应用</span>
          <span>Skill Helm</span>
        </div>
        <div className="about-row">
          <span className="about-label">版本</span>
          {appVersion ? (
            <span className="mono">v{appVersion}</span>
          ) : versionError ? (
            <span>
              <span className="error">读取失败：{versionError}</span>{" "}
              <button type="button" onClick={loadVersion}>
                重试
              </button>
            </span>
          ) : (
            <span className="meta-line">读取中…</span>
          )}
        </div>

        <div className="panel-section">
          <div className="panel-title">更新</div>
          <div className="about-row">
            <button
              type="button"
              onClick={() => void runCheck()}
              disabled={s.checkStatus === "checking" || busy}
            >
              {s.checkStatus === "checking" ? "正在检查…" : "检查更新"}
            </button>
          </div>
          <div className="about-status" aria-live="polite">
            {s.checkStatus === "latest" && <span className="ok">已是最新版本</span>}
            {s.checkStatus === "error" && <span className="error">检查失败：{s.checkError}</span>}
            {s.availableVersion && (
              <div>
                发现新版本 <b className="mono">v{s.availableVersion}</b>
                {s.currentVersion && (
                  <span className="meta-line">（当前 v{s.currentVersion}）</span>
                )}
              </div>
            )}

            {(s.installStatus === "downloading" || s.installStatus === "installing") && (
              <div>
                {s.installStatus === "downloading" ? "正在下载更新" : "正在安装更新"}
                {s.totalBytes !== null
                  ? `：${formatBytes(s.downloadedBytes)} / ${formatBytes(s.totalBytes)}`
                  : "…"}
                {percent !== null && (
                  <progress
                    className="about-progress"
                    max={100}
                    value={percent}
                    aria-label="下载进度"
                  />
                )}
              </div>
            )}
            {s.installStatus === "done" && (
              <div className="ok">更新已安装。应用即将自动重启；若未自动重启，请手动重新打开。</div>
            )}
            {s.installStatus === "error" && (
              <div>
                <span className="error">安装失败：{s.installError}</span>{" "}
                <button type="button" onClick={() => void install()}>
                  重试
                </button>
              </div>
            )}
          </div>
          {s.availableVersion && s.installStatus !== "done" && !busy && (
            <div className="about-row">
              <button type="button" className="primary" onClick={() => void install()}>
                立即更新
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
