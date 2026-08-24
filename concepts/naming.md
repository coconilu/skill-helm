# 命名规范

Skill 名（目录名 = frontmatter name）：

- 小写字母与数字，单词间用单个连字符：`video-summary`、`lark-doc`
- 正则：`^[a-z0-9]+(-[a-z0-9]+)*$`
- 名词性或动名词性短语，能读出其领域：`embedded-captions`、`find-skills`
- 避免：下划线、大小写混用、版本号后缀（`my-skill-v2`）、过泛的词（`utils`、`helper`、`misc`）

相关实体的命名：

- 分类（category）：领域维度，如 `media`、`docs`、`dev`
- 分组（group）：项目/工作流维度，如 `video-pipeline`、`feishu-suite`
- 同一 Skill 可属于多个分类、多个分组
