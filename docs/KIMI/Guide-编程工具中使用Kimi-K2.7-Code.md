# 在编程工具中使用 Kimi K2.7 Code 模型

> 来源：https://platform.kimi.com/docs/guide/agent-support

Kimi K2.7 Code 是一款具备超强代码和 Agent 能力的 MoE 架构基础模型。

## 使用注意事项

- **预算控制**：设置日消费上限，开启余额预警提醒
- **持续监控**：运行期间保持监控，避免无限循环或过度重试
- **模型选择**：对速度要求不高可选用 `kimi-k2.7-code`

## 获取 API Key

访问 https://platform.kimi.com/console/api-keys 创建获取 API Key。

## 在 Claude Code 中使用

### 配置环境变量 (macOS/Linux)

```shell
export ANTHROPIC_BASE_URL=https://api.moonshot.cn/anthropic
export ANTHROPIC_AUTH_TOKEN=${YOUR_MOONSHOT_API_KEY}
export ANTHROPIC_MODEL=kimi-k2.7-code
export ANTHROPIC_DEFAULT_OPUS_MODEL=kimi-k2.7-code
export ANTHROPIC_DEFAULT_SONNET_MODEL=kimi-k2.7-code
export ANTHROPIC_DEFAULT_HAIKU_MODEL=kimi-k2.7-code
export CLAUDE_CODE_SUBAGENT_MODEL=kimi-k2.7-code
export ENABLE_TOOL_SEARCH=false
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=262144
claude
```

### 配置环境变量 (Windows PowerShell)

```powershell
$env:ANTHROPIC_BASE_URL="https://api.moonshot.cn/anthropic";
$env:ANTHROPIC_AUTH_TOKEN="YOUR_MOONSHOT_API_KEY"
$env:ANTHROPIC_MODEL="kimi-k2.7-code"
$env:ANTHROPIC_DEFAULT_OPUS_MODEL="kimi-k2.7-code"
$env:ANTHROPIC_DEFAULT_SONNET_MODEL="kimi-k2.7-code"
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL="kimi-k2.7-code"
$env:CLAUDE_CODE_SUBAGENT_MODEL="kimi-k2.7-code"
$env:ENABLE_TOOL_SEARCH=false
$env:CLAUDE_CODE_AUTO_COMPACT_WINDOW="262144"
claude
```

## 在 Cline 中使用

1. VS Code 中搜索并安装 Cline 扩展
2. API Provider 选择 'Moonshot'
3. Moonshot Entrypoint 选择 'api.moonshot.cn'
4. Moonshot Api Key 配置 Kimi 开放平台的 Key
5. Model 选择 'kimi-k2.7-code'
6. Browser 勾选 'Disable browser tool usage'

## 在 RooCode 中使用

配置方式与 Cline 相同。

## 直接使用 API 调用

```python
from openai import OpenAI

client = OpenAI(
    api_key="$MOONSHOT_API_KEY",
    base_url="https://api.moonshot.cn/v1",
)

completion = client.chat.completions.create(
    model="kimi-k2.7-code",
    messages=[
        {"role": "system", "content": "你是 Kimi..."},
        {"role": "user", "content": "你好"}
    ]
)
print(completion.choices[0].message.content)
```
