# API 概述

> 来源：https://platform.kimi.com/docs/api/overview

## 服务地址

```
https://api.moonshot.cn
```

Kimi 开放平台提供兼容 OpenAI 协议的 HTTP API，您可以直接使用 OpenAI SDK 接入。

使用 SDK 时，`base_url` 设置为 `https://api.moonshot.cn/v1`；直接调用 HTTP 端点时，完整路径如 `https://api.moonshot.cn/v1/chat/completions`。

## 兼容 OpenAI

- 可以直接使用 OpenAI 官方 SDK（Python / Node.js）
- 支持大多数兼容 OpenAI 的第三方工具和框架（LangChain、Dify、Coze 等）
- 只需将 `base_url` 指向 `https://api.moonshot.cn/v1` 即可切换

> 部分参数为 Kimi 专有扩展：`thinking` 参数需要通过 SDK 的 `extra_body` 传递；`partial` 是写在 messages 中 assistant 消息上的字段（`"partial": true`），不是顶层请求参数。

## 认证

所有 API 请求需要在 HTTP 头中携带 API Key：

```
Authorization: Bearer $MOONSHOT_API_KEY
```

API Key 可在 Kimi 开放平台控制台 (https://platform.kimi.com/console/api-keys) 创建和管理。

> API Key 是敏感信息，请妥善保管。不要在客户端代码、公开仓库或日志中暴露。

## SDK 安装

### Python
```bash
pip install --upgrade 'openai>=1.0'
```

### Node.js
```bash
npm install openai
```

初始化客户端：

### Python
```python
from openai import OpenAI

client = OpenAI(
    api_key="$MOONSHOT_API_KEY",
    base_url="https://api.moonshot.cn/v1",
)
```

### Node.js
```javascript
const OpenAI = require("openai");

const client = new OpenAI({
    apiKey: "$MOONSHOT_API_KEY",
    baseURL: "https://api.moonshot.cn/v1",
});
```

> Python 版本需 ≥ 3.7.1，Node.js 版本需 ≥ 18，OpenAI SDK 版本需 ≥ 1.0.0。

## 通用请求头

| 请求头 | 值 | 说明 |
|-------|---|------|
| `Content-Type` | `application/json` | 请求体格式 |
| `Authorization` | `Bearer $MOONSHOT_API_KEY` | 认证令牌 |

## API 端点一览

| 端点 | 方法 | 说明 |
|-----|------|------|
| `/v1/chat/completions` | POST | 创建对话补全 |
| `/v1/models` | GET | 列出模型 |
| `/v1/tokenizers/estimate-token-count` | POST | 计算 Token |
| `/v1/users/me/balance` | GET | 查询余额 |
| `/v1/files` | POST | 上传文件 |
| `/v1/files` | GET | 列出文件 |
| `/v1/files/{file_id}` | GET | 获取文件信息 |
| `/v1/files/{file_id}` | DELETE | 删除文件 |
| `/v1/files/{file_id}/content` | GET | 获取文件内容 |
