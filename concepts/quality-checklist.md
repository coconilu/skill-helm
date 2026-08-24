# Skill 质量清单

创建或更新 Skill 后，用这份清单自查（`skill-helm lint` 覆盖其中可机器校验的部分）：

## 必须

- [ ] 目录名 = frontmatter name，符合命名规范
- [ ] description 包含「能力 + 触发场景」，1–3 句话
- [ ] 正文有「何时使用」「使用方式」两节起步
- [ ] `skill-helm lint` 无 error

## 应该

- [ ] description 覆盖用户的真实说法（中文、英文、近义词）
- [ ] 容易混淆时写明「不要用于」的边界
- [ ] 可执行的步骤封装成 scripts/，而不是让 Agent 每次重写命令
- [ ] 长篇参考材料放 references/，SKILL.md 保持简短（建议 500 行以内）
- [ ] 分类（category）与分组（group）已设置，便于 `list --category/--group` 检索

## 上架前（分享给他人）

- [ ] 没有硬编码的本机绝对路径、账号、密钥
- [ ] 依赖的工具与环境要求写进正文
- [ ] 在目标 Agent 里实际触发过一次
