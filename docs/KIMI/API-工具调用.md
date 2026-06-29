# 工具调用 (Tool Use / Function Calling)

> 来源：https://platform.kimi.com/docs/api/tool-use

Tool Use 或 Function Calling 是 Kimi 大模型的重要功能。在调用 API 时，您可以在 Messages 中描述工具或函数，并让 Kimi 大模型智能地选择输出一个包含调用一个或多个函数所需的参数的 JSON 对象。

## 基本示例

```json
{
  "model": "kimi-k2.6",
  "messages": [
    {
      "role": "user",
      "content": "编程判断 3214567 是否是素数。"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "CodeRunner",
        "description": "代码执行器，支持运行 python 和 javascript 代码",
        "parameters": {
          "properties": {
            "language": {
              "type": "string",
              "enum": ["python", "javascript"]
            },
            "code": {
              "type": "string",
              "description": "代码写在这里"
            }
          },
          "type": "object"
        }
      }
    }
  ]
}
```

## 工具定义规范

- `name` 需符合正则：`^[a-zA-Z_][a-zA-Z0-9-_]{2,63}$`
- `description` 部分介绍功能，方便模型判断和选择
- `parameters` 的 root 必须是 object，内容为 JSON Schema 子集（参见 MFJS 规范）
- `strict` 参数（boolean，可选）：
  - `true`（默认）：严格按 parameters schema 约束输出
  - `false`：仅保证输出为合法 JSON 对象
- tools 的 function 个数不得超过 128 个

## Python 调用示例

```python
from openai import OpenAI

client = OpenAI(
    api_key="$MOONSHOT_API_KEY",
    base_url="https://api.moonshot.cn/v1",
)

completion = client.chat.completions.create(
    model="kimi-k2.6",
    messages=[
        {"role": "system", "content": "你是 Kimi..."},
        {"role": "user", "content": "编程判断 3214567 是否是素数。"}
    ],
    tools=[{
        "type": "function",
        "function": {
            "name": "CodeRunner",
            "description": "代码执行器，支持运行 python 和 javascript 代码",
            "parameters": {
                "properties": {
                    "language": {"type": "string", "enum": ["python", "javascript"]},
                    "code": {"type": "string", "description": "代码写在这里"}
                },
                "type": "object"
            }
        }
    }]
)

print(completion.choices[0].message)
```

## 工具配置

可以使用 Agent 平台（如 Coze、Bisheng、Dify、LangChain 等框架）来创建和管理工具，并配合 Kimi 大模型设计更复杂的工作流。
