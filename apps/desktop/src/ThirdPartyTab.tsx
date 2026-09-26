import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type {
  ManagerVersionInfo,
  ThirdPartyCandidate,
  ThirdPartyEntryView,
  ThirdPartyManager,
} from "./types";

interface Props {
  refresh: () => void;
  refreshKey: number;
}

/** 前端 best-effort 最新版本来源：npm registry。没有公开版本源的托管方（如 ChatCut）不在此列，显示未知。 */
const NPM_PACKAGES: Record<string, string> = {
  hyperframes: "hyperframes",
  lark: "@larksuite/cli",
};

async function fetchNpmLatest(pkg: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

export default function ThirdPartyTab({ refresh, refreshKey }: Props) {
  const [managers, setManagers] = useState<ThirdPartyManager[]>([]);
  const [entries, setEntries] = useState<ThirdPartyEntryView[]>([]);
  const [candidates, setCandidates] = useState<ThirdPartyCandidate[]>([]);
  const [active, setActive] = useState("");
  const [versions, setVersions] = useState<Record<string, ManagerVersionInfo>>({});
  const [latest, setLatest] = useState<Record<string, string | null>>({});
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [latestLoading, setLatestLoading] = useState(false);
  const [copied, setCopied] = useState("");
  const [notice, setNotice] = useState("");
  const [registering, setRegistering] = useState("");

  const tell = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 6000);
  }, []);

  const load = useCallback(() => {
    api
      .thirdpartyManagers()
      .then((ms) => {
        setManagers(ms);
        setActive((a) => (ms.some((m) => m.id === a) ? a : (ms[0]?.id ?? "")));
      })
      .catch((e: Error) => tell(e.message));
    api
      .thirdpartyList()
      .then(setEntries)
      .catch(() => {});
    api
      .thirdpartyScan()
      .then(setCandidates)
      .catch(() => {});
  }, [tell]);

  /** 托管方当前版本：走服务端 best-effort 本地命令探测，可能各花数秒，失败显示未知。 */
  const checkVersions = useCallback(() => {
    setVersionsLoading(true);
    api
      .thirdpartyVersions()
      .then(setVersions)
      .catch(() => {})
      .finally(() => setVersionsLoading(false));
  }, []);

  /** 最新版本：前端直查 npm registry，拿不到就保持未知，不报错。 */
  const checkLatest = useCallback(() => {
    setLatestLoading(true);
    Promise.all(
      Object.entries(NPM_PACKAGES).map(
        async ([id, pkg]) => [id, await fetchNpmLatest(pkg)] as const,
      ),
    )
      .then((pairs) => setLatest(Object.fromEntries(pairs)))
      .catch(() => {})
      .finally(() => setLatestLoading(false));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey 为刻意多带的依赖，用作刷新触发器，effect 本身不消费
  useEffect(load, [load, refreshKey]);
  useEffect(() => {
    checkVersions();
    checkLatest();
  }, [checkVersions, checkLatest]);

  const copyCmd = async (cmd: string) => {
    try {
      await api.copy(cmd);
      setCopied(cmd);
      setTimeout(() => setCopied((c) => (c === cmd ? "" : c)), 2000);
    } catch (e) {
      tell(`复制失败：${(e as Error).message}`);
    }
  };

  const register = async (managedBy: string, names?: string[]) => {
    setRegistering(names?.join(",") ?? managedBy);
    try {
      const r = await api.thirdpartyRegister(managedBy, names);
      const ok = r.registered.map((x) => x.name);
      tell(
        ok.length
          ? `已登记：${ok.join("、")}（只登记管理，不搬移文件）`
          : `没有新登记${r.skipped.length ? `：${r.skipped.map((s) => `${s.name}（${s.reason}）`).join("；")}` : ""}`,
      );
      load();
      refresh();
    } catch (e) {
      tell((e as Error).message);
    } finally {
      setRegistering("");
    }
  };

  const entriesOf = (id: string) => entries.filter((e) => e.managedBy === id);
  const candidatesOf = (id: string) => candidates.filter((c) => c.managedBy === id);

  /** 托管方当前版本的展示文案；第三方 skill 内容随托管方一起更新，故以托管方版本为其版本代理。 */
  const currentText = (m: ThirdPartyManager) => {
    if (!versions[m.id] && versionsLoading) return "探测中…";
    return versions[m.id]?.current ? `v${versions[m.id]!.current}` : "未知";
  };

  const latestText = (m: ThirdPartyManager) => {
    if (!(m.id in NPM_PACKAGES)) return "未知";
    if (!(m.id in latest) && latestLoading) return "检测中…";
    return latest[m.id] ? `v${latest[m.id]}` : "未知";
  };

  const latestReason = (m: ThirdPartyManager) =>
    m.id in NPM_PACKAGES
      ? "未能从 npm registry 拿到最新版本（网络不可用或请求失败），可点「重新检查」重试"
      : "该托管方没有可查询的公开版本源，无法自动检查最新版本";

  const checkBusy = versionsLoading || latestLoading;
  const m = managers.find((x) => x.id === active);

  return (
    <div className="page tp-page">
      <div className="tp-intro">
        这里集中管理各托管方装在本机的 skill：只登记与展示，不收编进库存；升级由各托管方自己的
        渠道完成，第三方 skill 的当前版本以其托管方版本为准（best-effort，拿不到显示未知）。
      </div>
      {managers.length > 0 && (
        <div className="tp-subtabs">
          {managers.map((x) => (
            <button
              key={x.id}
              className={x.id === active ? "chip on" : "chip"}
              onClick={() => setActive(x.id)}
            >
              {x.label}
              <span className="tp-count">{entriesOf(x.id).length}</span>
            </button>
          ))}
        </div>
      )}
      {notice && <div className="toast">{notice}</div>}
      {m && (
        <section className="tp-manager">
          <header className="tp-head">
            <div className="tp-title-row">
              <h3>{m.label}</h3>
              <span className="tp-versions">
                当前版本 <b className="mono">{currentText(m)}</b>
                <span className="dim">·</span>
                最新版本 <b className="mono">{latestText(m)}</b>
                <button
                  className="tp-check-btn"
                  disabled={checkBusy}
                  title="重新探测本机版本与检查最新版本"
                  onClick={() => {
                    checkVersions();
                    checkLatest();
                  }}
                >
                  {checkBusy ? "检查中…" : "重新检查"}
                </button>
              </span>
            </div>
            <p className="tp-desc">{m.description}</p>
            {(currentText(m) === "未知" || latestText(m) === "未知") && (
              <p className="tp-hint">
                {currentText(m) === "未知" && m.upgrade.versionHint
                  ? `${m.upgrade.versionHint} `
                  : ""}
                {latestText(m) === "未知" ? latestReason(m) : ""}
              </p>
            )}
          </header>

          <div className="tp-upgrade">
            <div className="tp-upgrade-title">升级方式</div>
            <p>{m.upgrade.description}</p>
            {m.upgrade.commands.map((cmd) => (
              <div className="cmd-row" key={cmd}>
                <code className="mono">{cmd}</code>
                <button
                  className={copied === cmd ? "copy-cmd copied" : "copy-cmd"}
                  title={`复制命令：${cmd}`}
                  onClick={() => copyCmd(cmd)}
                >
                  {copied === cmd ? "已拷贝 ✓" : "拷贝"}
                </button>
              </div>
            ))}
            {m.upgrade.manual && <p className="dim">没有命令行时：{m.upgrade.manual}</p>}
          </div>

          <div className="tp-cards">
            {entriesOf(m.id).map((e) => (
              <div className="tp-card" key={e.name}>
                <div className="tp-card-head">
                  <span className="mono">{e.name}</span>
                  {e.exists ? (
                    <span className="badge ok-badge">正常</span>
                  ) : (
                    <span
                      className="badge missing-badge"
                      title="登记的目录已不存在，托管方可能已移除或重装"
                    >
                      目录缺失
                    </span>
                  )}
                </div>
                <div
                  className="tp-card-desc"
                  title="第三方 skill 由托管方管理，Skill Helm 不收录其描述"
                >
                  —
                </div>
                <div className="tp-card-meta">
                  <span className="chip">{e.category}</span>
                  <span className="dim">
                    装于 {e.adapterId} · 登记于 {e.registeredAt.slice(0, 10)}
                  </span>
                </div>
                <div
                  className="tp-card-version"
                  title="第三方 skill 内容随托管方一起更新，版本为 best-effort 推断"
                >
                  当前 {currentText(m)}（随 {m.label} 更新）
                </div>
              </div>
            ))}
          </div>
          {entriesOf(m.id).length === 0 && (
            <div className="empty-card tp-empty">
              暂无已登记的 {m.label} skill。本机检测到对应目录时会出现在下方，点击登记即可纳入管理
              （只登记，不搬移文件）。
            </div>
          )}

          {candidatesOf(m.id).length > 0 && (
            <div className="tp-candidates">
              <span>
                发现 {candidatesOf(m.id).length} 个未登记的 {m.label} skill 目录：
              </span>
              {candidatesOf(m.id).map((c) => (
                <span className="tp-candidate" key={`${c.adapterId}/${c.name}`}>
                  <code className="mono">{c.name}</code>
                  <button disabled={registering !== ""} onClick={() => register(m.id, [c.name])}>
                    {registering === c.name ? "登记中…" : "登记"}
                  </button>
                </span>
              ))}
              <button
                className="primary"
                disabled={registering !== ""}
                onClick={() => register(m.id)}
              >
                {registering === m.id ? "登记中…" : "全部登记"}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
