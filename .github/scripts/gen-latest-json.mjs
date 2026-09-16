// 生成 Tauri updater 所需的 latest.json。
// 用法: node .github/scripts/gen-latest-json.mjs <tag> [产物目录]
// 产物目录里应已归拢两个平台的构建产物（release workflow 的 publish job 负责下载合并）：
//   - windows-x86_64: NSIS 安装包 *.exe + *.exe.sig
//   - darwin-aarch64: *.app.tar.gz + *.app.tar.gz.sig
// 任一平台产物或签名缺失、安装包文件名中的版本号与 tag 不一致时直接报错退出，不静默跳过。
import fs from "node:fs";
import path from "node:path";

const fail = (msg) => {
  console.error(`gen-latest-json: ${msg}`);
  process.exit(1);
};

const tag = process.argv[2];
if (!tag) fail("用法: node gen-latest-json.mjs <tag> [产物目录]");

const distDir = process.argv[3] ?? "dist-release";
if (!fs.existsSync(distDir)) fail(`产物目录不存在: ${distDir}`);

// latest.json 的下载 URL 必须指向当前仓库，依赖 CI 注入，不做硬编码 fallback
const repo = process.env.GITHUB_REPOSITORY;
if (!repo) fail("环境变量 GITHUB_REPOSITORY 未设置（本地调试可手动 export）");

const pkgVersion = JSON.parse(
  fs.readFileSync("apps/desktop/package.json", "utf8"),
).version;

// tag 形如 v1.2.3 或 v1.2.3-issue12（issue 触发的预发布，version 字段仍用正式版本号）
const issueBase = tag.match(/^v(.+)-issue\d+$/)?.[1] ?? tag;
const tagVersion = issueBase.match(/^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)?)$/)?.[1];
if (!tagVersion) fail(`无法从 tag 解析版本号: ${tag}`);
if (pkgVersion !== tagVersion) {
  fail(`apps/desktop/package.json 版本 ${pkgVersion} 与 tag ${tag} 不一致`);
}

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
const files = walk(distDir).map((f) => path.normalize(f).replaceAll("\\", "/"));

const pick = (suffix) =>
  files.find((f) => f.endsWith(suffix) && !f.endsWith(".sig"));
const readSignature = (file, platform) => {
  const sigFile = `${file}.sig`;
  if (!files.includes(sigFile)) {
    fail(
      `未找到 ${platform} 的签名文件 ${sigFile}（TAURI_SIGNING_PRIVATE_KEY 未生效？）`,
    );
  }
  return fs.readFileSync(sigFile, "utf8").trim();
};

const exe = pick(".exe");
if (!exe) fail(`未在 ${distDir} 找到 windows-x86_64 安装包 (*.exe)`);
const windowsSignature = readSignature(exe, "windows-x86_64");

const tarball = pick(".app.tar.gz");
if (!tarball) fail(`未在 ${distDir} 找到 darwin-aarch64 产物 (*.app.tar.gz)`);
const darwinSignature = readSignature(tarball, "darwin-aarch64");

// NSIS 安装包命名: <产品名>_<版本>_<架构>-setup.exe，文件名中的版本必须与 tag 一致
const exeVersion = path
  .basename(exe)
  .match(/_(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)?)_/)?.[1];
if (!exeVersion) fail(`无法从安装包文件名解析版本号: ${exe}`);
if (exeVersion !== tagVersion) {
  fail(`安装包文件名中的版本 ${exeVersion} 与 tag ${tag} 不一致: ${exe}`);
}

// GitHub 发布资产会把文件名里的空格规范化为 '.'（Skill Helm_… → Skill.Helm_…），
// URL 里的空格写法（%20）会导致「检查更新成功、下载安装包 404」，必须逐字对应资产名
const assetUrl = (file) =>
  `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(
    path.basename(file).replaceAll(" ", "."),
  )}`;

const latest = {
  version: pkgVersion,
  notes: `Skill Helm ${tag}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": { signature: windowsSignature, url: assetUrl(exe) },
    "darwin-aarch64": { signature: darwinSignature, url: assetUrl(tarball) },
  },
};

const out = path.join(distDir, "latest.json");
fs.writeFileSync(out, JSON.stringify(latest, null, 2));
console.log(`已生成 ${out}`);
