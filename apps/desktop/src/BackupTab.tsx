import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { SyncStatus } from "./types";

type Busy = "bind" | "unbind" | "push" | "pull" | null;
type Feedback = { kind: "ok" | "error"; text: string } | null;

function formatTime(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

/** 备份 tab：私有 Git 仓库同步（bind / push / pull / 换绑 / 取消绑定）的图形界面。 */
export default function BackupTab({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [urlInput, setUrlInput] = useState("");
  /** 换绑编辑态：true 时远端 URL 显示为输入框 */
  const [editing, setEditing] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.syncStatus();
      setStatus(s);
      setLoadError("");
    } catch (e) {
      // 并发被拒（409）时保留旧状态即可；真正失败才提示
      if (!String((e as Error).message).includes("已有同步任务")) {
        setLoadError((e as Error).message);
      }
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey 为刻意多带的依赖，用作刷新触发器，effect 本身不消费
  useEffect(() => {
    void loadStatus();
  }, [loadStatus, refreshKey]);

  async function run(op: Exclude<Busy, null>, action: () => Promise<string>) {
    setBusy(op);
    setFeedback(null);
    try {
      const text = await action();
      setFeedback({ kind: "ok", text });
    } catch (e) {
      setFeedback({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
      setEditing(false);
      await loadStatus();
    }
  }

  async function bind(url: string) {
    const trimmed = url.trim();
    if (!trimmed) return;
    const wasBound = status?.bound;
    await run("bind", async () => {
      const r = await api.syncBind(trimmed);
      return wasBound
        ? `已换绑：${r.previousUrl ?? "(原仓库)"} → ${r.remoteUrl}（本地 v${r.version}）`
        : `已绑定 ${r.remoteUrl}（本地 v${r.version}）`;
    });
  }

  if (status === null && !loadError) return <div className="page">加载中…</div>;

  if (loadError && !status) {
    return (
      <div className="page">
        <div className="empty-card">
          <h3>无法读取同步状态</h3>
          <p>{loadError}</p>
          <p>请确认 skill-helm serve 正在运行，然后点击顶栏「刷新」重试。</p>
        </div>
      </div>
    );
  }

  if (!status?.bound) {
    return (
      <div className="page">
        <div className="empty-card sync-card">
          <h3>备份到私有 Git 仓库</h3>
          <p>
            绑定你自己的私有仓库后，Skill 库存（skills / concepts / registry
            等）可以推送和拉取，多台设备之间保持一致。每次推送都会让版本号
            +1，方便判断新旧、避免误删或覆盖。
          </p>
          <p className="sync-hint">
            认证由本机 git 凭据完成（Windows 凭据管理器 / macOS 钥匙串 / gh auth
            login），应用不会保存账号密码。支持 <code>git@host:path</code>、<code>https://</code>、
            <code>ssh://</code> 与 <code>file://</code> 地址。
          </p>
          <div className="sync-url-row">
            <input
              className="sync-url-input"
              type="text"
              placeholder="例如 git@github.com:you/skill-helm-store.git"
              value={urlInput}
              disabled={busy !== null}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void bind(urlInput);
              }}
            />
            <button
              type="button"
              className="primary"
              disabled={busy !== null || !urlInput.trim()}
              onClick={() => void bind(urlInput)}
            >
              {busy === "bind" ? "绑定中…" : "绑定"}
            </button>
          </div>
          {feedback && <p className={`sync-feedback ${feedback.kind}`}>{feedback.text}</p>}
          {loadError && <p className="sync-feedback error">{loadError}</p>}
        </div>
      </div>
    );
  }

  const { remoteUrl, localVersion, remoteVersion, ahead, behind, remoteReachable, error } = status;
  const versionLine =
    remoteVersion === null
      ? `本地 v${localVersion ?? 0} ↔ 远端（空仓库）`
      : `本地 v${localVersion ?? 0} ↔ 远端 v${remoteVersion ?? 0}`;
  const syncHint =
    (ahead ?? 0) > 0 && (behind ?? 0) > 0
      ? `本地领先 ${ahead} 个提交、落后 ${behind} 个提交——请先拉取再推送`
      : (ahead ?? 0) > 0
        ? `本地领先 ${ahead} 个提交，可推送`
        : (behind ?? 0) > 0
          ? `本地落后 ${behind} 个提交，可拉取`
          : "本地与远端已同步";

  return (
    <div className="page">
      <div className="sync-card">
        <div className="sync-url-row">
          {editing ? (
            <>
              <label className="sync-label" htmlFor="sync-url-input">
                新远端地址
              </label>
              <input
                id="sync-url-input"
                className="sync-url-input"
                type="text"
                value={urlInput}
                disabled={busy !== null}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && urlInput.trim()) void bind(urlInput);
                }}
              />
              <button
                type="button"
                className="primary"
                disabled={busy !== null || !urlInput.trim() || urlInput.trim() === remoteUrl}
                onClick={() => void bind(urlInput)}
              >
                {busy === "bind" ? "换绑中…" : "提交换绑"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setEditing(false);
                  setUrlInput("");
                }}
              >
                取消
              </button>
            </>
          ) : (
            <>
              <span className="sync-label">远端仓库</span>
              <span className="mono">{remoteUrl}</span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setUrlInput(remoteUrl ?? "");
                  setEditing(true);
                }}
              >
                换绑
              </button>
            </>
          )}
        </div>
        <div className="sync-versions">
          <b>{versionLine}</b>
          <span className="dim">·</span>
          <span>{syncHint}</span>
          {remoteReachable === false && (
            <span className="sync-feedback error" title={error}>
              远端不可达
            </span>
          )}
        </div>
        {status.lastSyncAt && (
          <p className="meta-line">上次同步：{formatTime(status.lastSyncAt)}</p>
        )}
        <div className="sync-actions">
          <button
            type="button"
            className="primary"
            disabled={busy !== null}
            onClick={() =>
              void run("push", async () => {
                const r = await api.syncPush();
                return r.pushed ? `已推送 v${r.version}` : (r.reason ?? "无变更，无需推送");
              })
            }
          >
            {busy === "push" ? "推送中…" : "推送"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run("pull", async () => {
                const r = await api.syncPull();
                if (!r.pulled) return r.reason ?? "已是最新";
                const warn = r.doctorIssues.length
                  ? `\n注意：${r.doctorIssues.length} 项待处理（见顶栏 ⚠）`
                  : "";
                return `已拉取到 v${r.version}${warn}`;
              })
            }
          >
            {busy === "pull" ? "拉取中…" : "拉取"}
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy !== null}
            onClick={() => {
              if (
                !window.confirm("确定取消绑定？本地数据与 .git 历史都会保留，仅解除与远端的关联。")
              )
                return;
              void run("unbind", async () => {
                const r = await api.syncUnbind();
                return `已解除绑定 ${r.remoteUrl ?? ""}（本地数据已保留）`;
              });
            }}
          >
            {busy === "unbind" ? "取消绑定中…" : "取消绑定"}
          </button>
        </div>
        {feedback && <p className={`sync-feedback ${feedback.kind}`}>{feedback.text}</p>}
      </div>
    </div>
  );
}
