# description 怎么写才被正确触发

Agent 只凭 description 判断「这个任务该不该用你这个 Skill」。写不好 = Skill 永远不触发，或到处误触发。

公式：**能力一句话 + 触发场景列举**。

```yaml
# 好：能力明确，触发语覆盖用户的真实说法
description: 给视频生成字幕。当用户提到加字幕、嵌入字幕、特效字幕、captions、subtitle 时使用。

# 坏：只有能力，没有触发场景
description: 一个字幕工具。
```

要点：

- 站在用户角度写触发词：中文说法、英文术语、近义词都列上。
- 写清「不要用于」的边界（当存在容易混淆的兄弟 Skill 时）。
- 不要把使用步骤写进 description——那是正文的事。
- 改动 description 后用 `skill-helm lint` 检查长度与格式。
