import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  doctor,
  getManager,
  listThirdParty,
  loadRegistry,
  matchManager,
  paths,
  registerThirdParty,
  scanThirdParty,
  unregisterThirdParty,
  updateRegistry,
} from "../src";
import { setupTestEnv, writeSkill, type TestEnv } from "./helpers";

let env: TestEnv;
beforeEach(() => {
  env = setupTestEnv();
  writeSkill(path.join(env.skillsDirFor("codex"), "chatcut-demo"), "chatcut-demo");
  writeSkill(path.join(env.skillsDirFor("kimi"), "lark-demo"), "lark-demo");
  writeSkill(path.join(env.skillsDirFor("codex"), "no-manager"), "no-manager");
});
afterEach(() => env.cleanup());

describe("matchManager", () => {
  it("按前缀匹配托管方", () => {
    expect(matchManager("chatcut-voice")?.id).toBe("chatcut");
    expect(matchManager("lark-base")?.id).toBe("lark");
    expect(matchManager("hyperframes")?.id).toBe("hyperframes");
    expect(matchManager("hyperframes-core")?.id).toBe("hyperframes");
    expect(matchManager("hyperframesque")).toBeUndefined();
    expect(matchManager("my-own-skill")).toBeUndefined();
  });

  it("getManager 未知托管方报错并列出已知", () => {
    expect(() => getManager("nope")).toThrow(/chatcut/);
  });
});

describe("scan / register / unregister", () => {
  it("scan 只报前缀匹配且未登记的目录", () => {
    expect(scanThirdParty()).toEqual([
      { name: "chatcut-demo", adapterId: "codex", managedBy: "chatcut" },
      { name: "lark-demo", adapterId: "kimi", managedBy: "lark" },
    ]);
  });

  it("批量登记幂等：第二次全部跳过，且不搬移目录、不写任何 skill 文件", () => {
    const before = fs.readFileSync(
      path.join(env.skillsDirFor("codex"), "chatcut-demo", "SKILL.md"),
      "utf8",
    );
    const first = registerThirdParty({ managedBy: "chatcut", all: true });
    expect(first.registered.map((r) => r.name)).toEqual(["chatcut-demo"]);
    expect(first.skipped).toEqual([]);

    const second = registerThirdParty({ managedBy: "chatcut", all: true });
    expect(second.registered).toEqual([]);
    expect(second.skipped).toEqual([]); // --all 的候选来自 scan，已登记的不会再进候选

    // 显式重名登记：幂等跳过而不是重复写入
    const explicit = registerThirdParty({
      managedBy: "chatcut",
      names: ["chatcut-demo"],
    });
    expect(explicit.registered).toEqual([]);
    expect(explicit.skipped).toEqual([{ name: "chatcut-demo", reason: "已登记" }]);

    const reg = loadRegistry();
    expect(Object.keys(reg.thirdParty)).toEqual(["chatcut-demo"]);
    const entry = reg.thirdParty["chatcut-demo"]!;
    expect(entry.managedBy).toBe("chatcut");
    expect(entry.adapterId).toBe("codex");
    expect(entry.registeredAt).toBeTruthy();

    // 只管理不收编：目录仍在适配器根下，库存里没有副本，文件未被改写
    expect(fs.existsSync(path.join(env.skillsDirFor("codex"), "chatcut-demo", "SKILL.md"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(paths.skills(), "chatcut-demo"))).toBe(false);
    expect(
      fs.readFileSync(path.join(env.skillsDirFor("codex"), "chatcut-demo", "SKILL.md"), "utf8"),
    ).toBe(before);
  });

  it("显式 names 登记不受前缀限制；不存在的名字进 skipped 而不抛错", () => {
    const result = registerThirdParty({
      managedBy: "hyperframes",
      names: ["no-manager"],
    });
    expect(result.registered.map((r) => r.name)).toEqual(["no-manager"]);
    const batch = registerThirdParty({
      managedBy: "chatcut",
      names: ["no-manager", "ghost"],
    });
    expect(batch.registered).toEqual([]);
    expect(batch.skipped).toEqual([
      {
        name: "no-manager",
        reason: "已登记为托管方 hyperframes（如需变更请先 unregister）",
      },
      { name: "ghost", reason: "任何适配器根目录下都不存在目录: ghost" },
    ]);
  });

  it("不同托管方重复登记跳过并说明", () => {
    registerThirdParty({ managedBy: "chatcut", names: ["chatcut-demo"] });
    const again = registerThirdParty({
      managedBy: "lark",
      names: ["chatcut-demo"],
    });
    expect(again.registered).toEqual([]);
    expect(again.skipped[0]?.reason).toContain("已登记为托管方 chatcut");
  });

  it("unregister 只删登记，目录保留，doctor 恢复报 unmanaged", () => {
    registerThirdParty({ managedBy: "chatcut", names: ["chatcut-demo"] });
    const result = unregisterThirdParty(["chatcut-demo", "never-registered"]);
    expect(result.removed).toEqual(["chatcut-demo"]);
    expect(result.missing).toEqual(["never-registered"]);
    expect(loadRegistry().thirdParty["chatcut-demo"]).toBeUndefined();
    expect(fs.existsSync(path.join(env.skillsDirFor("codex"), "chatcut-demo", "SKILL.md"))).toBe(
      true,
    );
  });
});

describe("doctor 与第三方登记", () => {
  it("已登记第三方不再计入 unmanaged；unregistered 检测保持现状", () => {
    writeSkill(path.join(paths.skills(), "store-only"), "store-only");
    expect(doctor(false).some((i) => i.type === "unmanaged" && i.name === "chatcut-demo")).toBe(
      true,
    );

    registerThirdParty({ managedBy: "chatcut", all: true });
    const issues = doctor(false);
    expect(issues.some((i) => i.type === "unmanaged" && i.name === "chatcut-demo")).toBe(false);
    expect(issues.some((i) => i.type === "unmanaged" && i.name === "lark-demo")).toBe(true);
    // 库存目录未登记的检测不受第三方登记影响
    expect(issues.some((i) => i.type === "unregistered" && i.name === "store-only")).toBe(true);
  });
});

describe("registry 读写往返", () => {
  it("thirdParty 字段落盘后重读不丢；旧 registry 无该字段也能正常加载", () => {
    registerThirdParty({ managedBy: "chatcut", names: ["chatcut-demo"] });
    const reg = loadRegistry();
    expect(reg.thirdParty["chatcut-demo"]?.managedBy).toBe("chatcut");

    // 模拟旧版本 registry.json：无 thirdParty 字段
    const file = paths.registry();
    const old = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    delete old.thirdParty;
    fs.writeFileSync(file, JSON.stringify(old), "utf8");
    const loaded = loadRegistry();
    expect(loaded.thirdParty).toEqual({});
    expect(loaded.skills).toEqual({});

    // 旧文件上追加第三方登记后往返仍完整
    updateRegistry((r) => {
      r.thirdParty["lark-demo"] = {
        adapterId: "kimi",
        managedBy: "lark",
        category: "lark-cli（飞书）",
        registeredAt: "2026-09-26T00:00:00.000Z",
      };
    });
    expect(loadRegistry().thirdParty["lark-demo"]?.registeredAt).toBe("2026-09-26T00:00:00.000Z");
  });

  it("listThirdParty 返回托管方元数据与目录存在性", () => {
    registerThirdParty({ managedBy: "lark", names: ["lark-demo"] });
    const view = listThirdParty({ managedBy: "lark" })[0]!;
    expect(view.name).toBe("lark-demo");
    expect(view.manager.upgrade.commands).toContain("lark-cli update");
    expect(view.exists).toBe(true);
    expect(listThirdParty({ managedBy: "chatcut" })).toEqual([]);
  });
});
