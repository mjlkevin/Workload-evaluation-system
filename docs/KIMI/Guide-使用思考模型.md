# 使用思考模型

> 来源：https://platform.kimi.com/docs/guide/use-kimi-k2-thinking-model

## 思考模型列表

| 模型 | 特点 |
|------|------|
| `kimi-k2.7-code`（最新） | 面向代码场景，**始终开启思考**，Preserved Thinking 始终开启 |
| `kimi-k2.6` | 通用思考模型，默认开启思考，可按需关闭，支持 Preserved Thinking |
| `kimi-k2.5` | 通用思考模型，默认开启思考，可按需关闭，不支持 Preserved Thinking |

## thinking 参数行为差异

| `thinking` 子字段 | `kimi-k2.7-code` | `kimi-k2.6` | `kimi-k2.5` |
|------------------|-----------------|-------------|-------------|
| `type`（思考开关） | 仅 `"enabled"`，始终思考 | `"enabled"`（默认）/ `"disabled"` | `"enabled"`（默认）/ `"disabled"` |
| `keep`（Preserved Thinking） | 始终开启，不传或传 `"all"` 均按 `"all"` 处理 | `null`（默认）/ `"all"`（启用） | 无此参数，不支持 |

## 使用 kimi-k2.7-code 模型

无需传入 `thinking` 参数，模型始终输出 `reasoning_content`。由于 Preserved Thinking 始终开启，多轮对话中请务必保留每一轮历史 assistant 消息的 `reasoning_content`。

```python
import os, openai

client = openai.Client(
    base_url="https://api.moonshot.cn/v1",
    api_key=os.getenv("MOONSHOT_API_KEY"),
)

stream = client.chat.completions.create(
    model="kimi-k2.7-code",
    messages=[
        {"role": "system", "content": "你是 Kimi。"},
        {"role": "user", "content": "用 Python 实现快速排序。"},
    ],
    max_tokens=1024*32,
    stream=True,
)

thinking = False
for chunk in stream:
    if chunk.choices:
        choice = chunk.choices[0]
        if choice.delta and hasattr(choice.delta, "reasoning_content"):
            if not thinking:
                thinking = True
                print("===开始思考===")
            print(getattr(choice.delta, "reasoning_content"), end="")
        if choice.delta and choice.delta.content:
            if thinking:
                thinking = False
                print("\n===思考结束===")
            print(choice.delta.content, end="")
```

## 使用 kimi-k2.6 模型

默认启用思考能力，无需传入 `thinking` 参数也会输出思考内容。

### 禁用思考

```python
response = client.chat.completions.create(
    model="kimi-k2.6",
    messages=[{"role": "user", "content": "你好"}],
    extra_body={"thinking": {"type": "disabled"}},
    max_tokens=1024*32
)
```

### 启用 Preserved Thinking

```python
response = client.chat.completions.create(
    model="kimi-k2.6",
    messages=[...],  # 包含历史 reasoning_content
    extra_body={"thinking": {"type": "enabled", "keep": "all"}},
    max_tokens=1024*32
)
```

## 流式输出中的 reasoning_content

思考内容通过 `reasoning_content` 字段在流式输出中返回，与 `content` 字段分开。

## 多步工具调用

使用思考模型进行多步工具调用时，必须在上下文中保留 `reasoning_content`。

## 注意事项

- 思考模型 temperature 不可修改（k2.7-code 和 k2.6 均为固定值）
- 多轮对话中需保留历史 reasoning_content（k2.7-code 必须，k2.6 可选）
- 使用 `$web_search` 内置工具时必须禁用思考
