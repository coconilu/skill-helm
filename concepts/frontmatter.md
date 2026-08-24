# frontmatter 约定

SKILL.md 以 YAML frontmatter 开头：

```yaml
---
name: video-summary
description: 总结视频内容。当用户给出视频链接并要求总结、分析、提取要点时使用。
---
```

规则：

- `name`：必需。与目录名一致，符合命名规范。
- `description`：必需。这是 Agent 发现 Skill 的唯一依据（见 description-writing）。建议 1–3 句话，不超过 1024 字符。
- 其他字段（如 `license`、`compatibility`）可选，平台原样保留，不做解释。

平台行为：

- `skill-helm create` 生成符合本约定的模板。
- `skill-helm update --description` 只改 frontmatter 的 description，不动正文。
- `skill-helm lint` 校验 name/description 的存在与一致性。
