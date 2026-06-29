# 文件接口与其他 API 参考

> 来源：https://platform.kimi.com/docs/api/files, /api/files-upload, /api/files-list, /api/balance, /api/list-models, /api/estimate

## 文件接口概览

Kimi API 提供文件管理功能，支持内容抽取、图片理解和视频理解。

### 上传文件 (POST /v1/files)

上传文件用于内容提取、图片理解或视频理解。

**purpose 参数说明：**
- `file-extract`：抽取文件内容
- `image`：上传图片，用于视觉理解
- `video`：上传视频，用于视频理解
- `batch`：上传 JSONL 文件，用于批处理任务

**文件对象 (FileObject) 字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 文件唯一标识符 |
| `object` | string | 对象类型，`file` |
| `bytes` | integer | 文件大小（字节） |
| `created_at` | integer | Unix 时间戳 |
| `filename` | string | 原始文件名 |
| `purpose` | string | `file-extract` / `image` / `video` / `batch` |
| `status` | string | 文件处理状态，如 `ready` |
| `status_details` | string | 处理失败或警告时的额外状态详情 |

**Python 列出文件示例：**
```python
file_list = client.files.list()
for file in file_list.data:
    print(file)
```

### 获取文件内容 (GET /v1/files/{file_id}/content)

获取以 `file-extract` 用途上传的文件的提取文本内容。

### 获取文件信息 (GET /v1/files/{file_id})

获取指定已上传文件的元数据。

### 删除文件 (DELETE /v1/files/{file_id})

删除一个已上传的文件。

---

## 查询余额 (GET /v1/users/me/balance)

查询可用余额、代金券余额和现金余额。

**响应字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.available_balance` | float | 可用余额（元），包含现金和代金券。≤0 时无法调用 API |
| `data.voucher_balance` | float | 代金券余额（元），不可为负 |
| `data.cash_balance` | float | 现金余额（元），可为负值表示欠费 |

---

## 列出模型 (GET /v1/models)

列出当前可用的所有模型。

**响应字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `data[].id` | string | 模型 ID，如 `kimi-k2.5` |
| `data[].owned_by` | string | 如 `moonshot` |
| `data[].context_length` | integer | 最大上下文长度（tokens） |
| `data[].supports_image_in` | boolean | 是否支持图片输入 |
| `data[].supports_video_in` | boolean | 是否支持视频输入 |
| `data[].supports_reasoning` | boolean | 是否支持深度思考 |

---

## 计算 Token (POST /v1/tokenizers/estimate-token-count)

估算给定消息和模型所需的 Token 数量。输入结构与聊天补全几乎相同。

### cURL 示例

```bash
curl 'https://api.moonshot.cn/v1/tokenizers/estimate-token-count' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MOONSHOT_API_KEY" \
  -d '{
    "model": "kimi-k2.6",
    "messages": [
        {"role": "system", "content": "你是 Kimi..."},
        {"role": "user", "content": "你好，1+1等于多少？"}
    ]
}'
```

**请求参数：**
- `model`（必填）：模型 ID
- `messages`（必填）：消息列表

**响应：**
```json
{
  "data": {
    "total_tokens": 80
  }
}
```

当没有 error 字段时，取 `data.total_tokens` 作为计算结果。
