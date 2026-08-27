import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import * as core from "@skill-helm/core";

export interface ServerInfo {
  origin: string;
  pid: number;
  startedAt: string;
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** 写入系统剪贴板（文本先 base64 再经命令行传入，避免控制台代码页乱码；后台静默）。 */
function setClipboardText(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") return reject(new Error("剪贴板写入暂未支持该平台"));
    const b64 = Buffer.from(text, "utf8").toString("base64");
    const ps = `Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`;
    const child = spawn("powershell", ["-NoProfile", "-Command", ps], { stdio: "ignore", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Set-Clipboard 退出码 ${code}`))));
  });
}

/** 用系统方式打开目录：folder = 文件管理器，code = VS Code。后台静默，不弹控制台窗口。 */
function openPath(dir: string, target: "folder" | "code"): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === "win32") {
    // Windows 上统一走 cmd：explorer /n 强制开新的文件管理器窗口（否则 Win11 只会在已有窗口
    // 里静默加一个后台标签页，用户以为没反应）、code 启动 VS Code。
    // 直接 spawn explorer.exe 在无控制台环境下会静默失败；windowsHide 保证不弹控制台黑窗。
    cmd = "cmd";
    args = target === "code" ? ["/c", "code", dir] : ["/c", "start", "", "explorer.exe", `/n,"${dir}"`];
  } else if (target === "code") {
    cmd = "code";
    args = [dir];
  } else if (platform === "darwin") {
    cmd = "open";
    args = [dir];
  } else {
    cmd = "xdg-open";
    args = [dir];
  }
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => undefined);
  child.unref();
}

/**
 * 本地 HTTP API：packages/core 的薄包装，只监听回环地址。
 * 桌面端（Tauri）与浏览器调试共用；启动后把 origin 写入 ~/.skill-helm/server.json 并打印到 stdout。
 */
export async function startServer(opts: { port?: number } = {}): Promise<ServerInfo> {
  core.ensureStore();
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const seg = url.pathname.split("/").filter(Boolean);
    try {
      // GET /api/meta
      if (req.method === "GET" && url.pathname === "/api/meta") {
        return sendJson(res, 200, {
          adapters: core.loadAdapters().map((a) => ({ id: a.id, covers: a.covers ?? [] })),
          store: core.paths.home(),
          history: core.historyStatus(),
        });
      }
      // GET /api/skills?category=&group=&status=
      if (req.method === "GET" && url.pathname === "/api/skills") {
        const skills = core.listSkills({
          category: url.searchParams.get("category") ?? undefined,
          group: url.searchParams.get("group") ?? undefined,
          status: (url.searchParams.get("status") as "enabled" | "disabled" | null) ?? undefined,
        });
        return sendJson(res, 200, skills);
      }
      // POST /api/skills {name, description, categories?, groups?, tags?}
      if (req.method === "POST" && url.pathname === "/api/skills") {
        const body = await readBody(req);
        const summary = core.createSkill({
          name: String(body.name ?? ""),
          description: String(body.description ?? ""),
          categories: asStringList(body.categories),
          groups: asStringList(body.groups),
          tags: asStringList(body.tags),
        });
        return sendJson(res, 200, summary);
      }
      // /api/skills/<name>[/action]
      if (seg[0] === "api" && seg[1] === "skills" && seg[2]) {
        const name = decodeURIComponent(seg[2]);
        const action = seg[3];
        if (req.method === "GET" && !action) return sendJson(res, 200, core.getSkill(name));
        if (req.method === "DELETE" && !action) {
          core.removeSkill(name);
          return sendJson(res, 200, { removed: name });
        }
        if (req.method === "POST" && action === "update") {
          const body = await readBody(req);
          const summary = core.updateSkill(name, {
            description: typeof body.description === "string" ? body.description : undefined,
            categories: body.categories === undefined ? undefined : asStringList(body.categories),
            groups: body.groups === undefined ? undefined : asStringList(body.groups),
            tags: body.tags === undefined ? undefined : asStringList(body.tags),
          });
          return sendJson(res, 200, summary);
        }
        if (req.method === "POST" && action === "enable") {
          const body = await readBody(req);
          return sendJson(res, 200, core.enableSkill(name, asStringList(body.to)));
        }
        if (req.method === "POST" && action === "disable") {
          const body = await readBody(req);
          return sendJson(res, 200, core.disableSkill(name, asStringList(body.from)));
        }
        // POST /api/skills/<name>/open {target: "folder" | "code"}
        if (req.method === "POST" && action === "open") {
          const body = await readBody(req);
          const target = body.target === "code" ? "code" : "folder";
          const dir = core.skillDir(name);
          if (!fs.existsSync(dir)) return sendJson(res, 404, { error: `库存中不存在 Skill 目录: ${name}` });
          openPath(dir, target);
          return sendJson(res, 200, { opened: dir, target });
        }
      }
      // POST /api/clipboard {text} —— WebView2 里 navigator.clipboard 不可靠，由 sidecar 写系统剪贴板
      if (req.method === "POST" && url.pathname === "/api/clipboard") {
        const body = await readBody(req);
        await setClipboardText(String(body.text ?? ""));
        return sendJson(res, 200, { copied: true });
      }
      // POST /api/adopt {path, name?, from?}
      if (req.method === "POST" && url.pathname === "/api/adopt") {
        const body = await readBody(req);
        const result = core.adoptSkill(String(body.path ?? ""), {
          name: typeof body.name === "string" ? body.name : undefined,
          from: typeof body.from === "string" ? body.from : undefined,
        });
        return sendJson(res, 200, result);
      }
      // GET /api/search?q=&limit=
      if (req.method === "GET" && url.pathname === "/api/search") {
        const q = url.searchParams.get("q");
        if (!q) return sendJson(res, 400, { error: "缺少 q 参数" });
        const limit = Number(url.searchParams.get("limit") ?? "10");
        return sendJson(res, 200, await core.searchGitHub(q, limit));
      }
      // POST /api/install {repo, skill?}
      if (req.method === "POST" && url.pathname === "/api/install") {
        const body = await readBody(req);
        const result = await core.installFromGitHub(String(body.repo ?? ""), {
          skill: typeof body.skill === "string" ? body.skill : undefined,
        });
        return sendJson(res, 200, result);
      }
      // GET /api/doctor
      if (req.method === "GET" && url.pathname === "/api/doctor") {
        return sendJson(res, 200, { issues: core.doctor(url.searchParams.get("fix") === "1") });
      }
      // GET /api/history?limit=
      if (req.method === "GET" && url.pathname === "/api/history") {
        const status = core.historyStatus();
        if (!status.enabled) return sendJson(res, 200, { enabled: false, events: [] });
        const limit = Number(url.searchParams.get("limit") ?? "100");
        return sendJson(res, 200, { enabled: true, path: status.path, events: core.listHistory({ limit }) });
      }
      // GET /api/concepts
      if (req.method === "GET" && url.pathname === "/api/concepts") {
        return sendJson(res, 200, core.listConcepts());
      }
      sendJson(res, 404, { error: `未知路由: ${req.method} ${url.pathname}` });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? 0);
      const info: ServerInfo = {
        origin: `http://127.0.0.1:${port}`,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(core.paths.home(), "server.json"), JSON.stringify(info, null, 2) + "\n", "utf8");
      process.stdout.write(`SKILL_HELM_API ${info.origin}\n`);
      resolve(info);
    });
  });
}
