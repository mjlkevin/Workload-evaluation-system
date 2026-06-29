# 错误说明

> 来源：https://platform.kimi.com/docs/api/errors

当请求失败时，API 会返回包含错误信息的 JSON 响应：

```json
{
    "error": {
        "type": "content_filter",
        "message": "The request was rejected because it was considered high risk"
    }
}
```

## 错误列表

### 400 — 请求错误

| error type | error message | 详细描述 |
|-----------|--------------|---------|
| `content_filter` | The request was rejected because it was considered high risk | 内容审查拒绝，您的输入或生成内容可能包含不安全或敏感内容 |
| `invalid_request_error` | Invalid request: {error_details} | 请求无效，通常是格式错误或缺少必要参数 |
| `invalid_request_error` | Input token length too long | 请求中的 tokens 长度过长 |
| `invalid_request_error` | Your request exceeded model token limit: {max_model_length} | 请求的 tokens 数和设置的 max_tokens 加和超过了模型规格长度 |
| `invalid_request_error` | Invalid purpose: only 'file-extract' accepted | 请求中的目的（purpose）不正确 |
| `invalid_request_error` | File size is too large, max file size is 100MB | 上传的文件大小超过了限制 |
| `invalid_request_error` | File size is zero | 上传的文件大小为 0 |
| `invalid_request_error` | The number of files you have uploaded exceeded the max file count {max_file_count} | 上传的文件总数超限 |

### 401 — 认证错误

| error type | error message | 详细描述 |
|-----------|--------------|---------|
| `invalid_authentication_error` | Invalid Authentication | 鉴权失败，请检查 API Key 是否正确 |
| `incorrect_api_key_error` | Incorrect API key provided | 鉴权失败，请检查 API Key 是否提供以及是否正确 |

> 如果您在 `platform.kimi.ai` 平台申请的 Key 用在了 `platform.kimi.com` 平台（或反之），也会收到 401 错误。两个平台的 Key 完全独立，不能混用。

### 403 — 权限错误

| error type | error message | 详细描述 |
|-----------|--------------|---------|
| `permission_denied_error` | The API you are accessing is not open | 访问的 API 暂未开放 |
| `permission_denied_error` | You are not allowed to get other user info | 不允许访问其他用户信息 |
| `permission_denied_error` | Your IP is not allowed to access this organization | 您的 IP 地址不在该组织的允许访问名单内 |

### 404 — 资源不存在

| error type | error message | 详细描述 |
|-----------|--------------|---------|
| `resource_not_found_error` | Not found the model {model-id} or Permission denied | 不存在此模型或者没有授权访问此模型 |

### 429 — 速率限制 / 额度不足

| error type | error message | 详细描述 |
|-----------|--------------|---------|
| `engine_overloaded_error` | The engine is currently overloaded | 当前并发请求过多，节点限流中，请稍后重试 |
| `exceeded_current_quota_error` | Your account is suspended | 账户余额不足，已停用 |
| `exceeded_current_quota_error` | You exceeded your current token quota | 账户额度不足 |
| `rate_limit_reached_error` | request reached organization max concurrency | 请求触发了账户并发个数的限制 |
| `rate_limit_reached_error` | request reached organization max RPM | 请求触发了账户 RPM 速率限制 |
| `rate_limit_reached_error` | request reached organization TPM rate limit | 请求触发了账户 TPM 速率限制 |
| `rate_limit_reached_error` | request reached organization TPD rate limit | 请求触发了账户 TPD 速率限制 |

### 500 — 服务端错误

| error type | error message | 详细描述 |
|-----------|--------------|---------|
| `server_error` | Failed to extract file: {error} | 解析文件失败，请重试 |
| `unexpected_output` | invalid state transition | 内部错误，请联系管理员 |

## 排障建议

- **收到 401**：先确认是否使用了正确平台的 API Key
- **收到 429**：考虑降低并发或升级用户等级
- **收到 500**：请稍后重试，如持续出现请联系支持团队
