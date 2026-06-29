# 联网搜索定价

> 来源：https://platform.kimi.com/docs/pricing/tools.md

## 产品定价

| 工具名称 | 计费单位 | 价格 | 说明 |
|---------|---------|-----|------|
| 联网搜索 | 1 次 | ¥0.03 | 触发 `$web_search` 工具调用，计费一次 |

## 联网搜索计费逻辑

当 `tools` 中加入 `$web_search` 工具，并获得 `finish_reason = tool_calls` 且 `tool_call.function.name = $web_search` 的响应时，收取 0.03 元；当 `finish_reason = stop` 时不收费。

使用 `$web_search` 时仍会按不同模型收取 `/chat/completions` 接口的 Tokens 费用。**额外注意：触发联网搜索时，搜索结果也会被计入 Tokens 中**。

总计费 Tokens 公式：
```
total_tokens = prompt_tokens + search_tokens + completions_tokens
```

如果触发联网搜索后不继续完成 `tool_calls` 而停止，则只收取 ¥0.03 工具调用费，搜索内容的 Tokens 不计费。
