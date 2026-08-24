# Skill 的结构（anatomy）

一个 Skill 是一个目录，最小组成只有一个文件：

```text
<skill-name>/
  SKILL.md        必需。frontmatter + 正文
```

可选组成：

```text
  scripts/        可执行脚本（Skill 让 Agent 调用，而不是让 Agent 重新发明）
  references/     参考文档（按需加载，不进系统提示词）
  assets/         模板、图片等静态资源
```

约定：

- 目录名必须等于 frontmatter 里的 `name`，且符合命名规范（见 naming）。
- SKILL.md 正文写「何时使用」和「使用方式」两节起步；细节放 references/，保持 SKILL.md 简短。
- 目录是自包含的：移动整个目录不破坏 Skill。
