# 常见问题及解决方案 (FAQ)

> 来源：https://platform.kimi.com/docs/guide/faq

## tool_calls 模型反复调用同一个工具

排查消息布局：
1. `finish_reason=tool_calls` 时，是否已将返回的 `choice.message` 原封不动添加到 `messages`
2. 每个 `tool_call` 是否有对应的 `role=tool` 消息
3. `tool_call_id` 是否与 `tool_call.id` 完全一致
4. 流式输出时是否正确拼接了 `tool_calls`

可在 system prompt 中追加提醒：重复 3 次时提醒不要重复调用，重复 5 次时提供工具名和参数。

## API 与 Kimi 智能助手结果不一致

API 和 Kimi 智能助手使用同一模型。不一致的原因可能是 System Prompt 不同，以及 Kimi 智能助手提供了计算器等工具而 API 未默认提供。

## 联网搜索功能

Kimi API 现已提供联网搜索功能，详见「使用 Kimi API 的联网搜索功能」指南。

## 返回内容不完整或被截断

检查 `choice.finish_reason`，若为 `length`，说明超过了 `max_completion_tokens`。解决方案：
- 使用 Partial Mode 继续输出
- 增大 `max_completion_tokens`
- 使用 estimate-token-count 接口计算输入 Tokens

## 模型输出长度

| 模型 | 最大输出长度 |
|------|-----------|
| moonshot-v1-8k | 8*1024 - prompt_tokens |
| moonshot-v1-32k | 32*1024 - prompt_tokens |
| moonshot-v1-128k | 128*1024 - prompt_tokens |
| kimi-k2.6/k2.5 | 256*1024 - prompt_tokens |

## 汉字数量估算

- moonshot-v1-8k：约 1.5 万汉字
- moonshot-v1-32k：约 6 万汉字
- moonshot-v1-128k：约 20 万汉字
- kimi-k2.6/k2.5：约 40 万汉字

## 文件抽取不准确

- 文本文件：提取文字内容
- 图片文件：OCR 识别文字
- PDF：纯图片用 OCR，否则仅提取文本
- 图片若无文字内容会导致解析失败

## content_filter 错误

输入或输出内容包含不安全或敏感内容。注意：模型生成的内容也可能触发此错误。

## Connection 错误

- 检查超时设置和代理服务器
- **推荐启用流式输出 `stream=True`** 减少 Connection 错误

## model_not_found 错误

确保设置了 `base_url=https://api.moonshot.cn/v1`。

## 数值计算错误

推荐使用工具调用 `tool_calls` 提供计算器功能。

## 无法回答今天日期

在 system prompt 中提供当前日期信息。

## max_completion_tokens 的误解

`max_completion_tokens` 是允许生成的的最大 Token 上限，不是指示模型输出特定字数。它不会作为 prompt 的一部分输入模型。

## RPM 限制触发

OpenAI SDK 默认重试 2 次（总计 3 次请求），会占用 RPM 额度。tier0 用户一次错误请求可能消耗完所有 RPM。

## 两个平台的 Key 不能混用

- 中国境内：platform.kimi.com，base_url: https://api.moonshot.cn/v1
- 境外：platform.kimi.ai，base_url: https://api.moonshot.ai/v1
- 两个平台的账户和 Key 完全独立
