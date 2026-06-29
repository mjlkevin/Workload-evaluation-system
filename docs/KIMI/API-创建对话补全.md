# 创建对话补全

> 来源：https://platform.kimi.com/docs/api/chat
> 为聊天消息创建补全结果。支持标准聊天、Partial Mode 和 Tool Use（函数调用）。

## content 字段说明

`content` 字段支持以下两种形式：

**纯文本字符串**
```json
"content": "你好"
```

**对象数组**（用于多模态输入）
```json
"content": [
    { "type": "text", "text": "描述这张图片" },
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
    { "type": "video_url", "video_url": { "url": "data:video/mp4;base64,..." } }
]
```

### 参数说明

| 参数名称 | 是否必须 | 说明 | 类型 |
|---------|---------|------|------|
| `type` | required | 内容类型 | `"text"` \| `"image_url"` \| `"video_url"` |
| `text` | 当 `type=text` 时必填 | 文本内容 | string |
| `image_url` | 当 `type=image_url` 时必填 | 图片，支持对象形式或直接传入 URL 字符串 | object \| string |
| `video_url` | 当 `type=video_url` 时必填 | 视频，支持对象形式或直接传入 URL 字符串 | object \| string |

支持两种格式：
- base64 编码：`data:image/png;base64,...` 或 `data:video/mp4;base64,...`
- 文件引用：`ms://<file_id>`

## 响应格式

### 非流式响应

```json
{
    "id": "cmpl-04ea926191a14749b7f2c7a48a68abc6",
    "object": "chat.completion",
    "created": 1698999496,
    "model": "kimi-k2.6",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "你好，李雷！1+1等于2。"
            },
            "finish_reason": "stop"
        }
    ],
    "usage": {
        "prompt_tokens": 19,
        "completion_tokens": 21,
        "total_tokens": 40,
        "cached_tokens": 10
    }
}
```

### 流式响应

```
data: {"id":"cmpl-xxx","object":"chat.completion.chunk","created":1698999575,"model":"kimi-k2.6","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}
data: {"id":"cmpl-xxx","object":"chat.completion.chunk","created":1698999575,"model":"kimi-k2.6","choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}
...
data: {"id":"cmpl-xxx","object":"chat.completion.chunk","created":1698999575,"model":"kimi-k2.6","choices":[{"index":0,"delta":{},"finish_reason":"stop","usage":{...}}]}
data: [DONE]
```

## 请求参数（OpenAPI Schema 摘要）

### 模型特定参数

**kimi-k2.7-code 系列**
- `model`: `kimi-k2.7-code` | `kimi-k2.7-code-highspeed`
- `thinking`: 始终开启思考，`type` 仅支持 `"enabled"`，`keep` 仅接受 `"all"`（Preserved Thinking 始终开启）

**kimi-k2.6**
- `model`: `kimi-k2.6`
- `thinking`: 支持 `{"type": "enabled"}` 或 `{"type": "disabled"}`
- `thinking.keep`: `null`（默认不保留历史思考）或 `"all"`（启用 Preserved Thinking）

**kimi-k2.5**
- `model`: `kimi-k2.5`
- `thinking`: 支持 `{"type": "enabled"}` 或 `{"type": "disabled"}`

**moonshot-v1 系列**
- `model`: `moonshot-v1-8k` | `moonshot-v1-32k` | `moonshot-v1-128k` | `moonshot-v1-auto` | vision-preview 变体
- `temperature`: 默认 0.0
- `top_p`: 默认 1.0
- `n`: 默认 1，最大 5
- `presence_penalty`: 默认 0
- `frequency_penalty`: 默认 0

### 通用参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `messages` | array | 对话消息列表（必填） |
| `max_tokens` | integer | 已弃用，请使用 max_completion_tokens |
| `max_completion_tokens` | integer | 生成的最大 Token 数量 |
| `response_format` | object | 输出格式：`text` / `json_object` / `json_schema` |
| `stop` | string/array | 停用词，最多 5 个，每个不超过 32 字节 |
| `stream` | boolean | 是否流式输出，默认 false |
| `stream_options.include_usage` | boolean | 流式响应中是否包含 Token 统计 |
| `tools` | array | 工具列表，最多 128 个 |
| `prompt_cache_key` | string | 缓存键，用于优化缓存命中率 |
| `safety_identifier` | string | 用户安全标识符 |

### Message 对象

| 字段 | 类型 | 说明 |
|------|------|------|
| `role` | string | `system` / `user` / `assistant` |
| `content` | string/array | 消息内容 |
| `name` | string | 消息发送者名称（可选） |
| `partial` | boolean | 在 assistant 消息中设置为 true 启用 Partial Mode |

### ToolDefinition 对象

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | `function` |
| `function.name` | string | 函数名，需符合正则 `^[a-zA-Z_][a-zA-Z0-9-_]{2,63}$` |
| `function.description` | string | 函数功能描述 |
| `function.parameters` | object | JSON Schema 格式参数定义 |
| `function.strict` | boolean | 是否严格遵循 schema 约束，默认 true |

### response_format 对象

| 字段 | 说明 |
|------|------|
| `type` | `text`（默认）/ `json_object`（合法JSON）/ `json_schema`（按Schema约束，推荐） |
| `json_schema.name` | Schema 名称 |
| `json_schema.strict` | 是否严格，默认 true |
| `json_schema.schema` | JSON Schema 对象 |
