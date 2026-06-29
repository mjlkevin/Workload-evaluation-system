# Kimi K2.6 快速开始

> 来源：https://platform.kimi.com/docs/guide/kimi-k2-6-quickstart

## 模型介绍

Kimi K2.6 是 Kimi 最新最智能的模型，具备：
- 全面提升的通用 Agent、代码、视觉理解能力
- 支持文本、图片与视频输入
- 思考与非思考模式
- 256K 上下文窗口
- 在 Humanity's Last Exam、SWE-Bench Pro、DeepSearchQA 等基准测试中取得行业领先

## 图片理解示例

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

## 视频理解示例

```python
video_path = "kimi.mp4"
with open(video_path, "rb") as f:
    video_data = f.read()
video_url = f"data:video/{os.path.splitext(video_path)[1].lstrip('.')};base64,{base64.b64encode(video_data).decode('utf-8')}"

completion = client.chat.completions.create(
    model="kimi-k2.6",
    messages=[
        {"role": "system", "content": "你是 Kimi。"},
        {"role": "user", "content": [
            {"type": "video_url", "video_url": {"url": video_url}},
            {"type": "text", "text": "请描述视频的内容。"},
        ]},
    ],
)
```

## 最佳实践

- **支持格式**：图片 png/jpeg/webp/gif；视频 mp4/mpeg/mov/avi/x-flv/mpg/webm/wmv/3gpp
- **Tokens 计算**：图片视频动态计算，可通过 estimate-token-count 接口预估
- **分辨率建议**：图片不超过 4K (4096*2160)，视频不超过 1080p
- **大文件**：大视频必须使用文件上传方式；多次引用的图片/视频推荐文件上传
- **图片数量**：无限制，但请求 Body 不超过 100M
- **URL 格式图片**：不支持，仅支持 base64 编码

## 参数变动说明（K2.6/K2.5）

| 字段 | 说明 | 取值 |
|------|------|------|
| max_tokens | 默认 32768 | int |
| thinking | 新增，控制是否启用思考 | `{"type": "enabled"}` 或 `{"type": "disabled"}` |
| temperature | 固定值 1.0（思考模式）/ 0.6（非思考模式） | float |
| top_p | 固定值 0.95 | float |
| n | 固定值 1 | int |
| presence_penalty | 固定值 0.0 | float |
| frequency_penalty | 固定值 0.0 | float |

## Tool Use 参数兼容性（思考模式）

- `tool_choice` 只能使用 "auto" 和 "none"
- 多步工具调用时必须保留 `reasoning_content`
- 内置联网搜索 `$web_search` 工具暂不兼容思考模式

## 禁用思考能力

```python
response = client.chat.completions.create(
    model="kimi-k2.6",
    messages=[{"role": "user", "content": "你好"}],
    extra_body={"thinking": {"type": "disabled"}},
    max_tokens=1024*32
)
```
