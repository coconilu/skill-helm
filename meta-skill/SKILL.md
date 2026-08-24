---
name: skill-helm
description: 管理 Skill 的生命周期。当用户要创建新 skill、更新 skill、查看/列出 skill、禁用/启用/删除 skill、给 skill 分类分组、收编已有 skill、整理 skill 体系、或从市场搜索安装 skill 时使用。
---

# skill-helm

Skill Helm 的 Meta-Skill：通过 `skill-helm` CLI 管理 Skill 的全生命周期。

## 硬性规则

- **一律用 `skill-helm <cmd> --json` 操作**，绝不直接往各 agent 的 skills 目录（如 `~/.codex/skills`）手写文件。
- stdout 是 JSON 结果；退出码非 0 时 stdout 为 `{"error": ...}`。
- 删除（rm）前必须先向用户确认；禁用（disable）不影响文件，可放手执行。
- 从市场 install 前，先把候选列表给用户看过并得到确认，**不得擅自安装**。

## 创建新 Skill 的流程

1. `skill-helm concepts list` / `skill-helm concepts show <topic>` —— 先读概念注册表（anatomy、frontmatter、description-writing、naming、quality-checklist）。
2. `skill-helm create <name> --description "..." [--category a,b] [--group g] --json` —— 生成模板入库。
3. 编辑库存中的 `SKILL.md` 正文（`skill-helm show <name> --json` 可拿到库存信息），按 anatomy 补充 scripts/references。
4. `skill-helm lint <name> --json` —— 校验。
5. `skill-helm enable <name> --to codex,kimi-code --json` —— 启用到目标 agent。

## 从市场找 Skill 的流程

1. `skill-helm search "<用户需求的自然语言>" --json` —— 得到候选仓库（含星数、简介）。
2. 把候选罗列给用户，附你的匹配理由，让用户选择。
3. 用户确认后 `skill-helm install <owner/repo> [--skill name|all] --json` —— 含多个 Skill 的仓库会返回 candidates，需再指定。
4. 安装后默认未启用：`enable` 即试用，`disable` + `rm` 即清理。

## 日常管理速查

```text
skill-helm list [--category c] [--group g] [--status enabled|disabled] --json
skill-helm show <name> --json
skill-helm update <name> [--description "..."] [--category a,b] --json
skill-helm adopt <path> [--name n] [--from agent] --json   # 收编散落在 agent 目录里的 Skill
skill-helm enable <name> --to <agents> --json
skill-helm disable <name> --from <agents> --json           # 只摘联接，不删文件
skill-helm categorize <name> --set a,b --json
skill-helm group <name> --set g --json
skill-helm rm <name> --json                                # 需先全部禁用
skill-helm doctor [--fix] --json                           # 一致性校验与修复
skill-helm history status --json                           # 历史记录（可选，见下）
```

## 历史记录（可选，不强制）

平台默认无持久化依赖。若用户想要变更历史（何时创建/更新/启停了哪个 Skill）：

1. 让用户给一个空目录，`skill-helm history init <path> --json`。
2. 之后所有变更自动追加到该目录的 `events.ndjson`（用户可自己 git init 变成仓库）。
3. 查历史：`skill-helm history list [--name n] [--limit k] --json`。

## 注意

- enable/disable 的 `<agents>` 为逗号分隔的适配器 id；常见的有 `codex`、`kimi-code`、`agents-shared`。
- adopt 会移动目录进库存并在原位置留下联接；如报告其他 agent 下有同名真实目录冲突，先把冲突情况告知用户，不要擅自处理。
- search/install 需要访问 GitHub；网络不通时如实告知用户，不要编造搜索结果。
