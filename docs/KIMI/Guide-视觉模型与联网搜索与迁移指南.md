# 使用 Kimi 视觉模型

> 来源：https://platform.kimi.com/docs/guide/use-kimi-vision-model

Kimi 视觉模型能够理解视觉内容，包括图片文字、颜色、物体形状等。最新模型还支持视频内容理解。

支持的模型：`moonshot-v1-*-vision-preview`、`kimi-k2.5`、`kimi-k2.6`、`kimi-k2.7-code`、`kimi-k2.7-code-highspeed`

## 使用 base64 上传图片

```python
import os, base64
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("MOONSHOT_API_KEY"),
    base_url="https://api.moonshot.cn/v1",
)

image_path = "kimi.png"
with open(image_path, "rb") as f:
    image_data = f.read()
image_url = f"data:image/{os.path.splitext(image_path)[1].lstrip('.')};base64,{base64.b64encode(image_data).decode('utf-8')}"

completion = client.chat.completions.create(
    model="kimi-k2.6",
    messages=[
        {"role": "system", "content": "你是 Kimi。"},
        {"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": image_url}},
            {"type": "text", "text": "请描述图片的内容。"},
        ]},
    ],
)
print(completion.choices[0].message.content)
```

## 重要注意事项

- `message.content` 字段类型由 `string` 变更为 `array[object]`
- **不要**将 JSON 数组序列化后以 string 放入 content，会导致无法正确识别
- 支持格式：图片 png/jpeg/webp/gif；视频 mp4/mpeg/mov/avi 等
- 图片分辨率建议不超过 4K，视频不超过 1080p
- 大文件必须使用文件上传方式
- 图片数量无限制，但请求 Body 不超过 100M
- 不支持 URL 格式图片，仅支持 base64 编码

---

# 使用 Kimi API 的联网搜索功能

> 来源：https://platform.kimi.com/docs/guide/use-web-search

## 内置联网搜索工具

Kimi 提供了内置工具函数 `builtin_function.$web_search`，实现开箱即用的联网搜索。

### $web_search 声明

```python
tools = [
    {
        "type": "builtin_function",  # 使用 builtin_function 表示 Kimi 内置工具
        "function": {
            "name": "$web_search",
        },
    },
]
```

- `$` 前缀表示 Kimi 内置函数
- **使用 `$web_search` 时必须禁用模型的思考能力**
- `$web_search` 可与普通 `function` 共存

### 执行示例

```python
from typing import *
import os, json
from openai import OpenAI

client = OpenAI(
    base_url="https://api.moonshot.cn/v1",
    api_key=os.environ.get("MOONSHOT_API_KEY"),
)

def search_impl(arguments: Dict[str, Any]) -> Any:
    """使用 Kimi 内置 search 工具时，只需原封不动返回 arguments"""
    return arguments

def chat(messages):
    completion = client.chat.completions.create(
        model="kimi-k2.6",
        messages=messages,
        max_tokens=32768,
        extra_body={"thinking": {"type": "disabled"}},  # 必须禁用思考
        tools=[{
            "type": "builtin_function",
            "function": {"name": "$web_search"},
        }]
    )
    # 处理 tool_calls...
    return completion
```

---

# 从 OpenAI 迁移到 Kimi API

> 来源：https://platform.kimi.com/docs/guide/migrating-from-openai-to-kimi

## API 兼容性

Kimi API 兼容 OpenAI 接口规范，只需替换 `base_url` 和 `api_key`：

```python
from openai import OpenAI

client = OpenAI(
    api_key="MOONSHOT_API_KEY",  # 替换为 Kimi API Key
    base_url="https://api.moonshot.cn/v1",  # 替换 base_url
)
```

兼容的接口：`/v1/chat/completions`、`/v1/files`、`/v1/files/{file_id}`、`/v1/files/{file_id}/content`

## 与 OpenAI 的差异

### temperature 和 N 值
- Kimi API：`temperature` 接近 0 时只能 `n=1`，否则返回错误
- **Kimi temperature 范围 [0, 1]，OpenAI 范围 [0, 2]**
- k2.6/k2.5 思考模式固定 temperature=1.0，非思考模式固定 0.6

### stream 模式下的 usage 值
- Kimi 在每个 choice 的结束数据块中都放置 `usage` 信息

### 已被废弃的 function_call
- Kimi API 不支持已废弃的 `functions` 参数，请使用 `tools`（tool_calls）

## 迁移建议
- 替换 `base_url` 和 `api_key`
- 使用 `tools` 替代 `functions`
- 注意 temperature 范围差异
- k2.6/k2.5 不要显式设置 temperature
