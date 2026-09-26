import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestEnv, type TestEnv } from "../../core/test/helpers";
import { startServer } from "../src/server";

/**
 * HTTP 路由层测试：core / CLI e2e 都不经过 server.ts 的路由分发，
 * 这里直接起真实 server（端口 0）打 HTTP 请求，防止路由形状回归。
 */
let env: TestEnv;
let origin: string;
let close: () => Promise<void>;

beforeAll(async () => {
  env = setupTestEnv();
  const info = await startServer({});
  origin = info.origin;
  close = info.close;
});

afterAll(async () => {
  await close();
  env.cleanup();
});

async function call(
  method: string,
  pathname: string,
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(origin + pathname, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

describe("server /api/sync 路由", () => {
  it("GET /api/sync/status 返回 200 与绑定状态（路由形状回归）", async () => {
    const { status, data } = await call("GET", "/api/sync/status");
    expect(status).toBe(200);
    expect(data).toEqual({ bound: false });
  });

  it("GET /api/sync（无 action）为未知路由 404，不得吞下 status 的 handler", async () => {
    const { status } = await call("GET", "/api/sync");
    expect(status).toBe(404);
  });

  it("POST /api/sync/bind 缺 url 返回 400", async () => {
    const { status, data } = await call("POST", "/api/sync/bind", {});
    expect(status).toBe(400);
    expect(data.error).toContain("缺少 url");
  });

  it("POST /api/sync/bind file:// 远端走通 core 薄包装并返回绑定结果", async () => {
    const remoteDir = path.join(env.root, "remote.git");
    execFileSync("git", ["init", "--bare", "-b", "main", remoteDir]);
    const { status, data } = await call("POST", "/api/sync/bind", {
      url: pathToFileURL(remoteDir).href,
    });
    expect(status).toBe(200);
    expect(data).toMatchObject({ bound: true, rebound: false });
    const after = await call("GET", "/api/sync/status");
    expect(after.data).toMatchObject({ bound: true });
  });
});
