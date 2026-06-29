# 快速开始

> 来源：https://platform.kimi.com/docs/api/quickstart

## 单轮对话

使用 OpenAI SDK 和 cURL 与 Chat Completions API 进行交互：

### Python

```python
from openai import OpenAI

client = OpenAI(
    api_key="$MOONSHOT_API_KEY",
    base_url="https://api.moonshot.cn/v1",
)

completion = client.chat.completions.create(
    model="kimi-k2.6",
    messages=[
        {"role": "system", "content": "你是 Kimi，由 Moonshot AI 提供的人工智能助手，你更擅长中文和英文的对话。你会为用户提供安全，有帮助，准确的回答。同时，你会拒绝一切涉及恐怖主义，种族歧视，黄色暴力等问题的回答。Moonshot AI 为专有名词，不可翻译成其他语言。"},
        {"role": "user", "content": "你好，我叫李雷，1+1等于多少？"}
    ]
)

print(completion.choices[0].message.content)
```

### cURL

```bash
curl https://api.moonshot.cn/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MOONSHOT_API_KEY" \
    -d '{
        "model": "kimi-k2.6",
        "messages": [
            {"role": "system", "content": "你是 Kimi，由 Moonshot AI 提供的人工智能助手，你更擅长中文和英文的对话。你会为用户提供安全，有帮助，准确的回答。同时，你会拒绝一切涉及恐怖主义，种族歧视，黄色暴力等问题的回答。Moonshot AI 为专有名词，不可翻译成其他语言。"},
            {"role": "user", "content": "你好，我叫李雷，1+1等于多少？"}
        ]
    }'
```

### Node.js

```javascript
const OpenAI = require("openai");

const client = new OpenAI({
    apiKey: "$MOONSHOT_API_KEY",
    baseURL: "https://api.moonshot.cn/v1",
});

async function main() {
    const completion = await client.chat.completions.create({
        model: "kimi-k2.6",
        messages: [
            {role: "system", content: "你是 Kimi，由 Moonshot AI 提供的人工智能助手，你更擅长中文和英文的对话。你会为用户提供安全，有帮助，准确的回答。同时，你会拒绝一切涉及恐怖主义，种族歧视，黄色暴力等问题的回答。Moonshot AI 为专有名词，不可翻译成其他语言。"},
            {role: "user", "content": "你好，我叫李雷，1+1等于多少？"}
        ]
    });
    console.log(completion.choices[0].message.content);
}

main();
```

其中 `$MOONSHOT_API_KEY` 需要替换为您在平台上创建的 API Key。

## 多轮对话

将模型输出的结果继续作为输入的一部分以实现多轮对话：

### Python

```python
from openai import OpenAI

client = OpenAI(
    api_key="$MOONSHOT_API_KEY",
    base_url="https://api.moonshot.cn/v1",
)

history = [
    {"role": "system", "content": "你是 Kimi，由 Moonshot AI 提供的人工智能助手..."}
]

def chat(query, history):
    history.append({"role": "user", "content": query})
    completion = client.chat.completions.create(
        model="kimi-k2.6",
        messages=history
    )
    result = completion.choices[0].message.content
    history.append({"role": "assistant", "content": result})
    return result

print(chat("地球的自转周期是多少？", history))
print(chat("月球呢？", history))
```

> 注意：随着对话的进行，模型每次需要传入的 token 都会线性增加，必要时需要一些策略进行优化，例如只保留最近几轮对话。

## 流式输出

使用 `stream: true` 启用流式返回，获得更好的用户体验：

### Python

```python
from openai import OpenAI

client = OpenAI(
    api_key="$MOONSHOT_API_KEY",
    base_url="https://api.moonshot.cn/v1",
)

response = client.chat.completions.create(
    model="kimi-k2.6",
    messages=[
        {"role": "system", "content": "你是 Kimi..."},
        {"role": "user", "content": "你好，我叫李雷，1+1等于多少？"},
    ],
    stream=True,
)

collected_messages = []
for idx, chunk in enumerate(response):
    chunk_message = chunk.choices[0].delta
    if not chunk_message.content:
        continue
    collected_messages.append(chunk_message)
    print(f"#{idx}: {''.join([m.content for m in collected_messages])}")
```

### Node.js

```javascript
const OpenAI = require("openai");

const client = new OpenAI({
    apiKey: "$MOONSHOT_API_KEY",
    baseURL: "https://api.moonshot.cn/v1",
});

async function main() {
    const stream = await client.chat.completions.create({
        model: "kimi-k2.6",
        messages: [
            {"role": "system", "content": "你是 Kimi..."},
            {"role": "user", "content": "你好，我叫李雷，1+1等于多少？"}
        ],
        stream: true,
    });

    for await (const chunk of stream) {
        const delta = chunk.choices[0].delta;
        if (delta.content) {
            process.stdout.write(delta.content);
        }
    }
}

main();
```
