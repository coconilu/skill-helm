import { invoke } from "@tauri-apps/api/core";
import type {
  DoctorIssue,
  ManagerVersionInfo,
  Meta,
  SkillDetail,
  SkillSummary,
  SyncBindResult,
  SyncPullResult,
  SyncPushResult,
  SyncStatus,
  SyncUnbindResult,
  ThirdPartyCandidate,
  ThirdPartyEntryView,
  ThirdPartyManager,
} from "./types";

let originPromise: Promise<string> | null = null;

/** API 地址：Tauri 环境由 Rust 侧 sidecar 告知；纯浏览器调试用 VITE_API_ORIGIN。 */
function getOrigin(): Promise<string> {
  if (!originPromise) {
    originPromise = (async () => {
      try {
        const origin = await invoke<string>("api_origin");
        if (origin) return origin;
      } catch {
        /* 非 Tauri 环境 */
      }
      const env = (import.meta.env?.VITE_API_ORIGIN as string | undefined) ?? "";
      if (env) return env.replace(/\/$/, "");
      throw new Error("无法确定 API 地址：请在 Tauri 应用中运行，或设置 VITE_API_ORIGIN");
    })();
  }
  return originPromise;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const origin = await getOrigin();
  const res = await fetch(origin + path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok || (data && typeof data === "object" && "error" in data && data.error)) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data;
}

function qs(params: Record<string, string | undefined>): string {
  const p = Object.entries(params).filter(([, v]) => v);
  return p.length ? "?" + p.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&") : "";
}

export interface SkillFilter {
  group?: string;
  status?: string;
}

export const api = {
  meta: () => call<Meta>("GET", "/api/meta"),
  skills: (f: SkillFilter) =>
    call<SkillSummary[]>("GET", "/api/skills" + qs(f as Record<string, string | undefined>)),
  getSkill: (name: string) => call<SkillDetail>("GET", `/api/skills/${encodeURIComponent(name)}`),
  update: (
    name: string,
    patch: { description?: string; categories?: string[]; groups?: string[] },
  ) => call<SkillSummary>("POST", `/api/skills/${encodeURIComponent(name)}/update`, patch),
  enable: (name: string, to: string[]) =>
    call<{ results: { adapter: string; state: string; message?: string }[] }>(
      "POST",
      `/api/skills/${encodeURIComponent(name)}/enable`,
      { to },
    ),
  disable: (name: string, from: string[]) =>
    call<{ results: { adapter: string; state: string; message?: string }[] }>(
      "POST",
      `/api/skills/${encodeURIComponent(name)}/disable`,
      { from },
    ),
  remove: (name: string) =>
    call<{ removed: string }>("DELETE", `/api/skills/${encodeURIComponent(name)}`),
  open: (name: string, target: "folder" | "code") =>
    call<{ opened: string; target: string }>(
      "POST",
      `/api/skills/${encodeURIComponent(name)}/open`,
      { target },
    ),
  copy: (text: string) => call<{ copied: boolean }>("POST", "/api/clipboard", { text }),
  doctor: () => call<{ issues: DoctorIssue[] }>("GET", "/api/doctor"),
  syncStatus: () => call<SyncStatus>("GET", "/api/sync/status"),
  syncBind: (url: string) => call<SyncBindResult>("POST", "/api/sync/bind", { url }),
  syncUnbind: () => call<SyncUnbindResult>("POST", "/api/sync/unbind"),
  syncPush: () => call<SyncPushResult>("POST", "/api/sync/push"),
  syncPull: () => call<SyncPullResult>("POST", "/api/sync/pull"),
  thirdpartyManagers: () => call<ThirdPartyManager[]>("GET", "/api/thirdparty/managers"),
  thirdpartyList: (managedBy?: string) =>
    call<ThirdPartyEntryView[]>("GET", "/api/thirdparty" + qs({ managedBy })),
  /** best-effort 托管方版本探测；服务端同步跑本地命令，可能各花数秒。 */
  thirdpartyVersions: () =>
    call<Record<string, ManagerVersionInfo>>("GET", "/api/thirdparty/versions"),
  thirdpartyScan: () => call<ThirdPartyCandidate[]>("GET", "/api/thirdparty/scan"),
  thirdpartyRegister: (managedBy: string, names?: string[]) =>
    call<{ registered: ThirdPartyEntryView[]; skipped: { name: string; reason: string }[] }>(
      "POST",
      "/api/thirdparty/register",
      names ? { managedBy, names } : { managedBy, all: true },
    ),
};
