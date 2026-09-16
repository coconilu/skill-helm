import { useSyncExternalStore } from "react";
import { check as checkUpdater, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";

/**
 * 应用级更新状态：后台轮询、关于面板与 toast 共享同一份状态和安装锁。
 * 组件卸载不丢失更新任务；替换句柄前释放旧的 Tauri 资源。
 */

export type CheckStatus = "idle" | "checking" | "available" | "latest" | "error";
export type InstallStatus = "idle" | "downloading" | "installing" | "done" | "error";

export interface UpdatesState {
  /** 当前可用更新的目标版本；null 表示无可用更新 */
  availableVersion: string | null;
  currentVersion: string | null;
  checkStatus: CheckStatus;
  checkError: string | null;
  installStatus: InstallStatus;
  installError: string | null;
  downloadedBytes: number;
  /** 已知总大小时为字节数，未知为 null（显示不定进度） */
  totalBytes: number | null;
  /** 已被用户关闭提示的目标版本 */
  dismissedVersion: string | null;
}

const DISMISS_KEY = "skill-helm.update.dismissed";
const CHECK_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 30 * 60 * 1000;

let handle: Update | null = null;
let checkInFlight = false;
/** 安装锁：在首个 await 前同步置位，防止连点或双入口重复下载/安装 */
let installLocked = false;
/** 本任务已成功安装，等待重启，不再重复安装 */
let installed = false;

const listeners = new Set<() => void>();

let state: UpdatesState = {
  availableVersion: null,
  currentVersion: null,
  checkStatus: "idle",
  checkError: null,
  installStatus: "idle",
  installError: null,
  downloadedBytes: 0,
  totalBytes: null,
  dismissedVersion: readDismissedVersion(),
};

function readDismissedVersion(): string | null {
  // 存储损坏/不可用不能导致崩溃，仅失去跨重启的关闭记忆
  try {
    return window.localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function setState(patch: Partial<UpdatesState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function releaseHandle(target: Update | null) {
  // 关闭旧句柄释放 Tauri 资源；正在安装使用的句柄由调用方保证不在此处释放
  target?.close().catch(() => {});
}

export async function runCheck(): Promise<void> {
  // 去重；安装期间不让检查替换句柄
  if (checkInFlight || installLocked) return;
  checkInFlight = true;
  setState({ checkStatus: "checking", checkError: null });
  try {
    const next = await checkUpdater({ timeout: CHECK_TIMEOUT_MS });
    if (next === null) {
      if (!installLocked) {
        releaseHandle(handle);
        handle = null;
      }
      setState({
        availableVersion: null,
        currentVersion: null,
        checkStatus: "latest",
        checkError: null,
      });
    } else if (installLocked) {
      // 安装进行中：不让检查替换句柄或版本信息，只记录检查结果
      setState({ checkStatus: "available", checkError: null });
    } else {
      releaseHandle(handle);
      handle = next;
      setState({
        availableVersion: next.version,
        currentVersion: next.currentVersion,
        checkStatus: "available",
        checkError: null,
      });
    }
  } catch (e) {
    // 检查失败保留此前发现的可用更新，同时明确本次检查失败
    setState({
      checkStatus: "error",
      checkError: e instanceof Error ? e.message : String(e),
    });
  } finally {
    checkInFlight = false;
  }
}

export async function install(): Promise<void> {
  if (installLocked || installed || !handle) return;
  installLocked = true; // 首个 await 前同步置位
  setState({
    installStatus: "downloading",
    installError: null,
    downloadedBytes: 0,
    totalBytes: null,
  });
  try {
    await handle.downloadAndInstall((event: DownloadEvent) => {
      switch (event.event) {
        case "Started":
          setState({
            totalBytes: event.data.contentLength ?? null,
            installStatus: "downloading",
          });
          break;
        case "Progress":
          setState({
            downloadedBytes: state.downloadedBytes + event.data.chunkLength,
            installStatus: "downloading",
          });
          break;
        case "Finished":
          // 下载完成不等于安装成功，进入安装阶段展示
          setState({ installStatus: "installing" });
          break;
      }
    });
    installed = true;
    setState({ installStatus: "done" });
  } catch (e) {
    setState({
      installStatus: "error",
      installError: e instanceof Error ? e.message : String(e),
    });
  } finally {
    installLocked = false;
  }
}

/** 关闭本次更新提示：只隐藏 toast，不禁用检查；按目标版本持久化 */
export function dismiss(): void {
  if (!state.availableVersion) return;
  const version = state.availableVersion;
  setState({ dismissedVersion: version });
  try {
    window.localStorage.setItem(DISMISS_KEY, version);
  } catch {
    // 写入失败：本次会话内仍然保持关闭，不声称已跨重启保存
  }
}

export function getUpdatesState(): UpdatesState {
  return state;
}

export function shouldShowToast(s: UpdatesState = state): boolean {
  return (
    s.availableVersion !== null &&
    s.dismissedVersion !== s.availableVersion &&
    s.installStatus !== "done"
  );
}

/** 启动时检查一次，此后每 30 分钟轮询；返回清理函数 */
export function startPolling(): () => void {
  void runCheck();
  const timer = setInterval(() => void runCheck(), POLL_INTERVAL_MS);
  return () => clearInterval(timer);
}

export function useUpdates(): UpdatesState {
  return useSyncExternalStore(subscribe, getUpdatesState);
}
