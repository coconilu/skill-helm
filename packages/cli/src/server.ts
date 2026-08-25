import fs from "node:fs";
import http from "node:http";
import path from "node:path";
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
          adapters: core.loadAdapters().map((a) => a.id),
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
