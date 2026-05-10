---
name: <skill-name>
description: >-
  <一句话说明本 Skill 的用途、适用场景和触发条件。>
  <使用时机：用户在什么情况下应该调用此 Skill。>
---

# <标题：本 Skill 解决什么问题>

## 运行事实（以代码为准）

- **HTTP 前缀**：`{BASE}/api/vX`（`BASE` = 部署根，无尾部斜杠）。
- **鉴权方式**：<JWT / API Key / 无需鉴权，具体请求头格式>。
- **成功响应形态**：`{ "code": 0, "message": "ok", "data": ... }`（或说明非 JSON 场景）。
- **失败响应**：`code` 非 0，常伴 `message`、`details`；HTTP 状态与业务码对应。
- **专用路由**：<是否提供 `/api/vX/agent/*` 或走现有业务接口>。

## 核心流程 / 路径

**目标**：<一句话描述本路径要达成的效果。>

### 流程（顺序固定）

| 步 | 动作 | 方法 / 路径 | 说明 |
|----|------|-------------|------|
| 1 | <动作名> | `<METHOD> <path>` | <说明> |
| 2 | <动作名> | `<METHOD> <path>` | <说明> |
| 3 | <动作名> | `<METHOD> <path>` | <说明> |

### 关键约束

- <约束 1>
- <约束 2>
- <约束 3>

### 请求/响应示例

```json
// 请求示例
{
  "field": "value"
}
```

```json
// 响应示例（code === 0）
{
  "code": 0,
  "message": "ok",
  "data": { }
}
```

### curl 示例

```bash
API="${BASE}/api/vX"
TOKEN=...  # 登录获取

curl -sS -X POST "${API}/<path>" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"field":"value"}' \
  | tee result.json
```

## 首次配置清单（Agent 侧）

1. **设置 `BASE`**：<公网/内网/本地地址>。
2. **探活**：`<METHOD> {BASE}/api/vX/health`。
3. **登录/鉴权**：<具体步骤>。
4. **后续请求**：<请求头要求>。
5. **Token 过期**：<重试/刷新策略>。

## 账号前提

- <角色要求>
- <其他前提条件>

## 最小 curl 模板（复制后替换变量）

```bash
BASE="https://your-api-host"   # 改为实际部署根
API="${BASE}/api/vX"

# 探活
curl -sS "${API}/health"

# 登录（如需要）
TOKEN=$(curl -sS -X POST "${API}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${USER}\",\"password\":\"${PASS}\"}" \
  | jq -r '.data.token')

# 调用业务接口
curl -sS -X POST "${API}/<path>" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"field":"value"}'
```

## 常用接口速查（均需 Bearer，除非另有说明）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/vX/health` | 无需 Token |
| POST | `/api/vX/...` | <说明> |

## 给 Agent 系统提示的摘要句（可粘贴）

<一段极简摘要，说明本 Skill 的核心调用链和注意事项，供直接粘贴到 Agent 系统提示中。>

---

*本 Skill 版本：v0.1.0（草稿）*  
*对应系统版本：<如 v1.x.x>*  
*最后更新：<日期>*
