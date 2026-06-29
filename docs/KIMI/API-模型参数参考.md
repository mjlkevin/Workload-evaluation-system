# 模型参数参考

> 来源：https://platform.kimi.com/docs/api/models-overview

不同模型系列对 Chat Completions API 参数有不同的默认值和约束。

## 参数对比

| 参数 | kimi-k2.7-code 系列 | kimi-k2.6 | moonshot-v1 系列 |
|------|-------------------|-----------|----------------|
| `temperature` | **不可修改** | **不可修改** | 0.0 |
| `top_p` | 0.95 **不可改** | 0.95 **不可改** | 1.0 |
| `n` | 1 **不可改** | 1 **不可改** | 1（最大 5） |
| `presence_penalty` | 0 **不可改** | 0 **不可改** | 0（可修改） |
| `frequency_penalty` | 0 **不可改** | 0 **不可改** | 0（可修改） |
| `thinking` | 始终开启（不可禁用） | 支持 | — |

> 当 `temperature` 接近 0 时，`n` 只能为 1，否则将返回 `invalid_request_error`。

## Kimi K2.7 Code 系列 — thinking 参数

`kimi-k2.7-code` 系列包含 `kimi-k2.7-code` 及其高速版 `kimi-k2.7-code-highspeed`，二者为同一模型、参数约束完全一致，仅输出速度不同。

- **始终开启思考、不可禁用**（传入 `{"type": "disabled"}` 会报错）
- **Preserved Thinking 始终开启**（`thinking.keep` 不传或传 `"all"` 都按 `"all"` 处理）
- 调用时无需传入 `thinking` 参数，只需切换 `model` 即可

## Kimi K2.6 — thinking 参数

支持通过 `thinking` 参数控制是否启用深度思考。接受 `{"type": "enabled"}` 或 `{"type": "disabled"}`。

由于 OpenAI SDK 没有原生的 `thinking` 参数，需要使用 `extra_body` 传递：

### Python
```python
completion = client.chat.completions.create(
    model="kimi-k2.6",
    messages=[{"role": "user", "content": "你好"}],
    extra_body={
        "thinking": {"type": "disabled"}
    },
    max_tokens=1024*32,
)
```

### cURL
```bash
curl https://api.moonshot.cn/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MOONSHOT_API_KEY" \
  -d '{
    "model": "kimi-k2.6",
    "messages": [{"role": "user", "content": "你好"}],
    "thinking": {"type": "disabled"}
  }'
```
