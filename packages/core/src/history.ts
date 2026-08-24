import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig } from "./config";

export interface HistoryEvent {
  time: string;
  type: string;
  name?: string;
  detail?: Record<string, unknown>;
}

const EVENTS_FILE = "events.ndjson";

const HISTORY_README = `# Skill Helm 历史项目

这个目录是 Skill Helm 的可选持久化后端，完全归你所有：

- \`events.ndjson\`：一行一个 JSON 事件，按时间追加。事件类型：
  create / update / adopt / enable / disable / remove / install / init / history-init
- 事件字段：\`time\`（ISO 时间）、\`type\`、\`name\`（Skill 名）、\`detail\`（附加信息）
- 平台只追加、不改写、不删除；你可以随时 \`git init\` 把它变成仓库，获得完整的版本历史
- 不想要了：删掉这个目录，并在 \`~/.skill-helm/config.json\` 移除 \`history\` 字段即可
`;

function eventsPath(): string | null {
  const dir = loadConfig().history?.path;
  return dir ? path.join(dir, EVENTS_FILE) : null;
}

/**
 * 追加一条历史事件。
 * 未配置历史项目时是 no-op（平台默认无持久化依赖）；写入失败不阻塞主流程。
 */
export function recordEvent(type: string, name?: string, detail?: Record<string, unknown>): void {
  const file = eventsPath();
  if (!file) return;
  const event: HistoryEvent = {
    time: new Date().toISOString(),
    type,
    ...(name ? { name } : {}),
    ...(detail ? { detail } : {}),
  };
  try {
    fs.appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
  } catch {
    /* 历史项目不可写不影响主操作 */
  }
}

/** 创建（或指向）一个空项目作为历史数据后端，并写入配置。 */
export function initHistory(dir: string): { path: string } {
  const abs = path.resolve(dir);
  fs.mkdirSync(abs, { recursive: true });
  const events = path.join(abs, EVENTS_FILE);
  if (!fs.existsSync(events)) fs.writeFileSync(events, "", "utf8");
  const readme = path.join(abs, "README.md");
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, HISTORY_README, "utf8");
  const cfg = loadConfig();
  cfg.history = { path: abs };
  saveConfig(cfg);
  recordEvent("history-init", undefined, { path: abs });
  return { path: abs };
}

function readEvents(dir: string): HistoryEvent[] {
  const file = path.join(dir, EVENTS_FILE);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HistoryEvent);
}

export function historyStatus(): { enabled: boolean; path?: string; events: number } {
  const dir = loadConfig().history?.path;
  if (!dir) return { enabled: false, events: 0 };
  let events = 0;
  try {
    events = readEvents(dir).length;
  } catch {
    events = -1;
  }
  return { enabled: true, path: dir, events };
}

export function listHistory(filter: { name?: string; limit?: number } = {}): HistoryEvent[] {
  const dir = loadConfig().history?.path;
  if (!dir) throw new Error("未配置历史项目；先执行 history init <path>");
  let events = readEvents(dir);
  if (filter.name) events = events.filter((e) => e.name === filter.name);
  return events.reverse().slice(0, filter.limit ?? 50);
}
