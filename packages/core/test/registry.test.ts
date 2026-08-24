import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRegistry, paths, updateRegistry } from "../src";
import { setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeEach(() => {
  env = setupTestEnv();
});
afterEach(() => env.cleanup());

describe("registry", () => {
  it("空库存返回空注册表", () => {
    const reg = loadRegistry();
    expect(reg.version).toBe(1);
    expect(reg.skills).toEqual({});
  });

  it("updateRegistry 落盘且可重读", () => {
    updateRegistry((reg) => {
      reg.skills["demo"] = {
        enabledIn: [],
        categories: ["dev"],
        groups: [],
        tags: [],
        source: "local",
        createdAt: "t",
        updatedAt: "t",
      };
    });
    const reg = loadRegistry();
    expect(reg.skills["demo"].categories).toEqual(["dev"]);
    expect(fs.existsSync(paths.registry())).toBe(true);
  });

  it("陈旧锁会被打破", () => {
    fs.mkdirSync(path.dirname(paths.lock()), { recursive: true });
    fs.writeFileSync(paths.lock(), "stale");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(paths.lock(), old, old);
    updateRegistry((reg) => {
      reg.categories["x"] = {};
    });
    expect(loadRegistry().categories["x"]).toBeDefined();
    expect(fs.existsSync(paths.lock())).toBe(false);
  });
});
