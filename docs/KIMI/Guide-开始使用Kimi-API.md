# 开始使用 Kimi API

> 来源：https://platform.kimi.com/docs/guide/start-using-kimi-api.md

Kimi API 提供了与 Kimi 大模型交互的能力。

## Python 示例

```python
from openai import OpenAI

client = OpenAI(
    api_key="MOONSHOT_API_KEY",
    base_url="https://api.moonshot.cn/v1",
)

completion = client.chat.completions.create(
    model="kimi-k2.6",
    messages=[
        {"role": "system", "content": "你是 Kimi，由 Moonshot AI 提供的人工智能助手。"},
        {"role": "user", "content": "你好，我叫李雷，1+1等于多少？"}
    ]
)
print(completion.choices[0].message.content)
```

## Node.js 示例

```js
const OpenAI = require("openai")
const client = new OpenAI({
    apiKey: "MOONSHOT_API_KEY",
    baseURL: "https://api.moonshot.cn/v1",
})

async function main(){
    const completion = await client.chat.completions.create({
        model: "kimi-k2.6",
        messages: [
            {"role": "system", "content": "你是 Kimi，由 Moonshot AI 提供的人工智能助手。"},
            {"role": "user", "content": "你好，我叫李雷，1+1等于多少？"}
        ]
    })
    console.log(completion.choices[0].message.content)
}
main()
```

## 准备工作

1. Python 3.8+ 或 Node.js 环境
2. 安装 OpenAI SDK：`pip install --upgrade 'openai>=1.0'` 或 `npm install openai@latest`
3. 从 Kimi 开放平台创建 API Key
