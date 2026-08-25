#!/usr/bin/env node
import { parseArgs } from "node:util";
import * as core from "@skill-helm/core";
import { printJson, table, truncate } from "./format";
import { startServer } from "./server";

const HELP = `skill-helm — Agent 无关的 Skill 管理

用法: skill-helm <命令> [参数] [--json]

命令:
  init                                   初始化库存，安装 meta-skill 并启用到所有 agent
  list [--category c] [--group g] [--status enabled|disabled]
  show <name>
  create <name> --description "..." [--category a,b] [--group g1,g2] [--tags t1,t2]
  update <name> [--description "..."] [--category a,b] [--group g1,g2] [--tags t1,t2]
  adopt <path> [--name n] [--from agent]
  enable <name> --to codex,kimi-code
  disable <name> --from codex
  rm <name>
  categorize <name> --set a,b
  group <name> --set g1,g2
  concepts list | show <topic> | sync
  history init <path> | list [--name n] [--limit k] | status
  search <query> [--limit n]               在 GitHub 上按描述搜索 Skill 仓库
  install <owner/repo> [--skill name|all]  从 GitHub 仓库安装 Skill 进库存
  serve [--port n]                         启动本地 HTTP API（桌面端/浏览器用，仅回环）
  lint <name>
  doctor [--fix]

所有命令支持 --json：结构化结果输出到 stdout；出错时 stdout 输出 {"error": ...} 且退出码为 1。
`;

type OptionShape = Record<string, { type: "string" | "boolean"; default?: string | boolean }>;
type Values = Record<string, string | boolean | undefined>;

/** 解析参数；返回值做宽松类型化，取值一律经由 str()/csv()/need()。 */
function parse(rest: string[], options: OptionShape): { values: Values; positionals: string[] } {
  const { values, positionals } = parseArgs({
    args: rest,
    options: { json: { type: "boolean", default: false }, ...options },
    allowPositionals: true,
  });
  return { values: values as Values, positionals };
}

function str(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function csv(v: string | boolean | undefined): string[] | undefined {
  const s = str(v);
  if (!s) return undefined;
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function need(value: unknown, what: string): string {
  if (typeof value !== "string" || !value) throw new Error(`缺少 ${what}`);
  return value;
}

function printTargets(results: core.TargetResult[]): boolean {
  let hasError = false;
  for (const r of results) {
    const mark = r.state === "ok" ? "✓" : r.state === "already" ? "=" : "✗";
    if (r.state === "error") hasError = true;
    process.stdout.write(`${mark} ${r.adapter}${r.message ? ` — ${r.message}` : ""}\n`);
  }
  return hasError;
}

/** 异步命令（search/install）的错误出口：与同步路径一致，--json 时 stdout 输出 {"error": ...}。 */
function runAsync(json: boolean, task: () => Promise<void>): void {
  task().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    if (json) printJson({ error: message });
    else process.stderr.write(`error: ${message}\n`);
    process.exit(1);
  });
}

function main(argv: string[]): void {
  const [cmd, ...rest] = argv;
  const json = rest.includes("--json");
  try {
    switch (cmd) {
      case undefined:
      case "help":
      case "--help": {
        process.stdout.write(HELP);
        return;
      }
      case "init": {
        const { values } = parse(rest, {});
        const result = core.initPlatform();
        if (values.json) printJson(result);
        else {
          process.stdout.write(`概念注册表已同步 ${result.concepts.length} 个主题\n`);
          if (printTargets(result.enableResults)) process.exit(1);
        }
        return;
      }
      case "list": {
        const { values } = parse(rest, {
          category: { type: "string" },
          group: { type: "string" },
          status: { type: "string" },
        });
        const skills = core.listSkills({
          category: str(values.category),
          group: str(values.group),
          status: str(values.status) as "enabled" | "disabled" | undefined,
        });
        if (values.json) printJson(skills);
        else {
          process.stdout.write(
            table(
              ["名称", "状态", "启用于", "分类", "分组", "描述"],
              skills.map((s) => [
                s.name,
                s.status === "enabled" ? "启用" : "禁用",
                s.enabledIn.join(",") || "-",
                s.categories.join(",") || "-",
                s.groups.join(",") || "-",
                truncate(s.description, 40),
              ]),
            ) + "\n",
          );
        }
        return;
      }
      case "show": {
        const { values, positionals } = parse(rest, {});
        const { summary, issues } = core.getSkill(need(positionals[0], "<name>"));
        if (values.json) printJson({ summary, issues });
        else {
          const s = summary;
          process.stdout.write(
            [
              `名称:     ${s.name}`,
              `状态:     ${s.status === "enabled" ? "启用" : "禁用"}`,
              `启用于:   ${s.enabledIn.join(", ") || "-"}`,
              `分类:     ${s.categories.join(", ") || "-"}`,
              `分组:     ${s.groups.join(", ") || "-"}`,
              `标签:     ${s.tags.join(", ") || "-"}`,
              `来源:     ${s.source}`,
              `描述:     ${s.description || "-"}`,
              `更新于:   ${s.updatedAt}`,
              issues.length ? `lint:     ${issues.map((i) => `[${i.level}] ${i.message}`).join("；")}` : "lint:     通过",
            ].join("\n") + "\n",
          );
        }
        return;
      }
      case "create": {
        const { values, positionals } = parse(rest, {
          description: { type: "string" },
          category: { type: "string" },
          group: { type: "string" },
          tags: { type: "string" },
        });
        const summary = core.createSkill({
          name: need(positionals[0], "<name>"),
          description: need(values.description, "--description"),
          categories: csv(values.category),
          groups: csv(values.group),
          tags: csv(values.tags),
        });
        if (values.json) printJson(summary);
        else process.stdout.write(`已创建 ${summary.name}（在库存中；用 enable 启用到 agent）\n`);
        return;
      }
      case "update": {
        const { values, positionals } = parse(rest, {
          description: { type: "string" },
          category: { type: "string" },
          group: { type: "string" },
          tags: { type: "string" },
        });
        const summary = core.updateSkill(need(positionals[0], "<name>"), {
          description: str(values.description),
          categories: csv(values.category),
          groups: csv(values.group),
          tags: csv(values.tags),
        });
        if (values.json) printJson(summary);
        else process.stdout.write(`已更新 ${summary.name}\n`);
        return;
      }
      case "adopt": {
        const { values, positionals } = parse(rest, {
          name: { type: "string" },
          from: { type: "string" },
        });
        const result = core.adoptSkill(need(positionals[0], "<path>"), {
          name: str(values.name),
          from: str(values.from),
        });
        if (values.json) printJson(result);
        else {
          process.stdout.write(`已收编 ${result.summary.name}（启用于: ${result.summary.enabledIn.join(", ") || "-"}）\n`);
          for (const c of result.conflicts) {
            process.stdout.write(`注意: ${c.adapter} 下存在同名真实目录 ${c.path}，未动它，请人工确认后处理\n`);
          }
        }
        return;
      }
      case "enable":
      case "disable": {
        const { values, positionals } = parse(rest, {
          to: { type: "string" },
          from: { type: "string" },
        });
        const name = need(positionals[0], "<name>");
        const targets = csv(cmd === "enable" ? values.to : (values.from ?? values.to));
        if (!targets || targets.length === 0) {
          throw new Error(cmd === "enable" ? "缺少 --to（如 --to codex,kimi-code）" : "缺少 --from（如 --from codex）");
        }
        const { results } = cmd === "enable" ? core.enableSkill(name, targets) : core.disableSkill(name, targets);
        if (values.json) {
          printJson({ results });
          if (results.some((r) => r.state === "error")) process.exit(1);
        } else if (printTargets(results)) process.exit(1);
        return;
      }
      case "rm": {
        const { values, positionals } = parse(rest, {});
        const name = need(positionals[0], "<name>");
        core.removeSkill(name);
        if (values.json) printJson({ removed: name });
        else process.stdout.write(`已删除 ${name}\n`);
        return;
      }
      case "categorize":
      case "group": {
        const { values, positionals } = parse(rest, { set: { type: "string" } });
        const name = need(positionals[0], "<name>");
        const set = csv(values.set) ?? [];
        const summary = cmd === "categorize" ? core.updateSkill(name, { categories: set }) : core.updateSkill(name, { groups: set });
        if (values.json) printJson(summary);
        else process.stdout.write(`已更新 ${name}: 分类=[${summary.categories.join(",")}] 分组=[${summary.groups.join(",")}]\n`);
        return;
      }
      case "concepts": {
        const { values, positionals } = parse(rest, {});
        const sub = positionals[0] ?? "list";
        if (sub === "list") {
          const list = core.listConcepts();
          if (values.json) printJson(list);
          else process.stdout.write(table(["主题", "标题"], list.map((c) => [c.name, c.title])) + "\n");
        } else if (sub === "show") {
          const content = core.showConcept(need(positionals[1], "<topic>"));
          if (values.json) printJson({ topic: positionals[1], content });
          else process.stdout.write(content);
        } else if (sub === "sync") {
          const { synced } = core.syncConcepts();
          if (values.json) printJson({ synced });
          else process.stdout.write(`已同步: ${synced.join(", ")}\n`);
        } else {
          throw new Error(`未知 concepts 子命令: ${sub}（支持 list / show / sync）`);
        }
        return;
      }
      case "history": {
        const { values, positionals } = parse(rest, {
          name: { type: "string" },
          limit: { type: "string" },
        });
        const sub = positionals[0] ?? "list";
        if (sub === "init") {
          const { path: p } = core.initHistory(need(positionals[1], "<path>"));
          if (values.json) printJson({ path: p });
          else process.stdout.write(`历史项目已配置: ${p}（之后的变更会追加到 events.ndjson）\n`);
        } else if (sub === "status") {
          const status = core.historyStatus();
          if (values.json) printJson(status);
          else if (!status.enabled) process.stdout.write("未启用（history init <path> 可配置一个空项目来记录历史）\n");
          else process.stdout.write(`已启用: ${status.path}，共 ${status.events} 条事件\n`);
        } else if (sub === "list") {
          const limitRaw = str(values.limit);
          const events = core.listHistory({ name: str(values.name), limit: limitRaw ? Number(limitRaw) : undefined });
          if (values.json) printJson(events);
          else {
            process.stdout.write(
              table(
                ["时间", "类型", "对象", "详情"],
                events.map((e) => [e.time.slice(0, 19).replace("T", " "), e.type, e.name ?? "-", e.detail ? truncate(JSON.stringify(e.detail), 50) : "-"]),
              ) + "\n",
            );
          }
        } else {
          throw new Error(`未知 history 子命令: ${sub}（支持 init / list / status）`);
        }
        return;
      }
      case "search": {
        const { values, positionals } = parse(rest, { limit: { type: "string" } });
        const query = need(positionals[0], "<query>");
        const limitRaw = str(values.limit);
        runAsync(Boolean(values.json), async () => {
          const candidates = await core.searchGitHub(query, limitRaw ? Number(limitRaw) : 10);
          if (values.json) printJson(candidates);
          else if (candidates.length === 0) process.stdout.write("没有找到匹配的仓库\n");
          else {
            process.stdout.write(
              table(
                ["仓库", "星数", "简介"],
                candidates.map((c) => [c.repo, String(c.stars), truncate(c.description, 60)]),
              ) + "\n",
            );
            process.stdout.write("\n用 install <owner/repo> 安装；含多个 Skill 时会列出候选供选择\n");
          }
        });
        return;
      }
      case "install": {
        const { values, positionals } = parse(rest, { skill: { type: "string" } });
        const repo = need(positionals[0], "<owner/repo>");
        runAsync(Boolean(values.json), async () => {
          const result = await core.installFromGitHub(repo, { skill: str(values.skill) });
          if (result.candidates && result.candidates.length > 0) {
            if (values.json) printJson({ candidates: result.candidates });
            else {
              process.stdout.write(
                "该仓库包含多个 Skill：\n" +
                  table(
                    ["名称", "目录", "描述"],
                    result.candidates.map((c) => [c.name, c.relativeDir, truncate(c.description, 50)]),
                  ) +
                  `\n请用 --skill <name> 指定一个，或 --skill all 全部安装\n`,
              );
            }
            return;
          }
          if (values.json) printJson(result);
          else {
            for (const s of result.installed) {
              const warn = s.issues.filter((i) => i.level !== "warning" || true).length;
              process.stdout.write(`已安装 ${s.name}（在库存中，默认未启用；用 enable 试用）\n`);
              if (warn > 0) process.stdout.write(`  lint 提醒: ${s.issues.map((i) => i.message).join("；")}\n`);
            }
          }
        });
        return;
      }
      case "serve": {
        const { values } = parse(rest, { port: { type: "string" } });
        const portRaw = str(values.port);
        runAsync(Boolean(values.json), async () => {
          const info = await startServer({ port: portRaw ? Number(portRaw) : undefined });
          if (!values.json) process.stderr.write(`Skill Helm API 已启动: ${info.origin}（仅回环，Ctrl+C 停止）\n`);
          else printJson(info);
        });
        return;
      }
      case "lint": {
        const { values, positionals } = parse(rest, {});
        const { issues } = core.getSkill(need(positionals[0], "<name>"));
        if (values.json) printJson({ issues });
        else if (issues.length === 0) process.stdout.write("通过\n");
        else process.stdout.write(issues.map((i) => `[${i.level}] ${i.rule}: ${i.message}`).join("\n") + "\n");
        if (issues.some((i) => i.level === "error")) process.exit(1);
        return;
      }
      case "doctor": {
        const { values } = parse(rest, { fix: { type: "boolean", default: false } });
        const issues = core.doctor(Boolean(values.fix));
        if (values.json) printJson({ issues });
        else if (issues.length === 0) process.stdout.write("一切正常\n");
        else {
          process.stdout.write(
            table(
              ["类型", "对象", "说明", values.fix ? "已修复" : ""].filter(Boolean),
              issues.map((i) => [i.type, [i.adapter, i.name].filter(Boolean).join(":"), i.message, values.fix ? (i.fixed ? "是" : "否") : ""]),
            ) + "\n",
          );
        }
        return;
      }
      default:
        process.stderr.write(`未知命令: ${cmd}\n\n${HELP}`);
        process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json) printJson({ error: message });
    else process.stderr.write(`error: ${message}\n`);
    process.exit(1);
  }
}

main(process.argv.slice(2));
