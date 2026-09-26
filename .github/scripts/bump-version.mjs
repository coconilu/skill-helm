// 手动触发 release 工作流时：升级版本号 + 更新 CHANGELOG.md
// 用法: node .github/scripts/bump-version.mjs <patch|minor|major>
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const bump = process.argv[2];
// 版本号必须全量同步的文件：App（apps/desktop）+ Tauri 配置 + CLI sidecar。
// CLI 版本缺一处不同步，App 与 sidecar 版本对账就会误报（v0.1.5、v0.1.6 两次手工对齐救场的教训）
const versionedPaths = [
  "apps/desktop/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "packages/cli/package.json",
];
const changelogPath = "CHANGELOG.md";

const pkg = JSON.parse(readFileSync(versionedPaths[0], "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);
const next =
  bump === "major"
    ? [major + 1, 0, 0]
    : bump === "minor"
      ? [major, minor + 1, 0]
      : bump === "patch"
        ? [major, minor, patch + 1]
        : null;
if (!next) throw new Error(`未知 bump 类型: ${bump}（支持 patch/minor/major）`);
const version = next.join(".");

// 三个文件的缩进均为 2 空格，JSON.stringify 重写后与原格式逐字节一致（除版本行），不产生 diff 噪音
for (const filePath of versionedPaths) {
  const json = JSON.parse(readFileSync(filePath, "utf8"));
  json.version = version;
  writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n");
}

// 收集自上一个 tag 以来的提交，生成 changelog 条目
let range = null;
try {
  const lastTag = execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
  range = `${lastTag}..HEAD`;
} catch {
  // 尚无任何 tag，收集全部提交
}
const logArgs = range ? ["log", range, "--pretty=format:- %s"] : ["log", "--pretty=format:- %s"];
const commits = execFileSync("git", logArgs, { encoding: "utf8" }).trim() || "- 无提交记录";

const date = new Date().toISOString().slice(0, 10);
const section = `## v${version}（${date}）\n\n${commits}\n\n`;
const old = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
const updated = old.startsWith("# ")
  ? old.replace(/^# .*\n+/, (m) => m + section)
  : `# Changelog\n\n${section}${old}`;
writeFileSync(changelogPath, updated);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `tag=v${version}\n`);
}
console.log(`bumped to v${version}`);
