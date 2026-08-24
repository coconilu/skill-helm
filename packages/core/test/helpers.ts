import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TestEnv {
  root: string;
  home: string;
  skillsDirFor: (id: string) => string;
  cleanup: () => void;
}

/** 每个用例一套独立库存 + 两个假 adapter（codex / kimi），通过环境变量隔离。 */
export function setupTestEnv(): TestEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-helm-test-"));
  const home = path.join(root, "store");
  const adaptersDir = path.join(root, "adapters");
  fs.mkdirSync(adaptersDir, { recursive: true });
  for (const id of ["codex", "kimi"]) {
    fs.writeFileSync(
      path.join(adaptersDir, `${id}.json`),
      JSON.stringify({ id, skillsDir: path.join(root, `${id}-skills`) }),
    );
  }
  process.env.SKILL_HELM_HOME = home;
  process.env.SKILL_HELM_ADAPTERS_DIR = adaptersDir;
  return {
    root,
    home,
    skillsDirFor: (id) => path.join(root, `${id}-skills`),
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
      delete process.env.SKILL_HELM_HOME;
      delete process.env.SKILL_HELM_ADAPTERS_DIR;
    },
  };
}

export function writeSkill(dir: string, name: string, description = "这是一个用于测试的 skill 描述"): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`, "utf8");
}
