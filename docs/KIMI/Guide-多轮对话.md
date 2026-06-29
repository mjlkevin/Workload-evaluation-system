# 使用 Kimi API 进行多轮对话

> 来源：https://platform.kimi.com/docs/guide/engage-in-multi-turn-conversations-using-kimi-api

Kimi API 本身**不具有记忆功能，它是无状态的**。需要手动维护每次请求的上下文（Context），把上一次请求过的内容手动加入到下一次请求中。

## 核心要点

- Kimi API 没有上下文记忆功能，需通过 `messages` 参数手动传递历史
- `messages` 中既要存储用户问题（role=user），也要存储模型回复（role=assistant）
- 随着对话轮次增多，`messages` 列表不断增长，Token 消耗线性增加
- 需要使用策略保持 `messages` 列表在可控范围内

## Python 多轮对话示例

```python
from openai import OpenAI

client = OpenAI(
    api_key="MOONSHOT_API_KEY",
    base_url="https://api.moonshot.cn/v1",
)

# 全局 messages 记录历史对话
messages = [
    {"role": "system", "content": "你是 Kimi..."},
]

def chat(input: str) -> str:
    global messages
    messages.append({"role": "user", "content": input})
    
    completion = client.chat.completions.create(
        model="kimi-k2.6",
        messages=messages
    )
    
    assistant_message = completion.choices[0].message
    messages.append(assistant_message)
    return assistant_message.content

print(chat("你好，我今年 27 岁。"))
print(chat("你知道我今年几岁吗？"))  # Kimi 会根据上下文知道你的年龄
```

## 控制上下文长度

当历史消息超过限制时，仅保留最新的 N 条消息：

```python
system_messages = [
    {"role": "system", "content": "你是 Kimi..."},
]
messages = []

def make_messages(input: str, n: int = 20) -> list[dict]:
    global messages
    messages.append({"role": "user", "content": input})
    
    new_messages = []
    new_messages.extend(system_messages)  # System Prompt 始终保留
    
    if len(messages) > n:
        messages = messages[-n:]  # 仅保留最新 N 条
    
    new_messages.extend(messages)
    return new_messages
```

## 注意事项

- 并发场景下可能需要读写锁
- 多用户场景需为每个用户单独维护 messages
- 可能需要持久化 messages
- 可能需要更精确的方式计算保留多少条消息
- 可考虑对被遗弃的消息做总结
