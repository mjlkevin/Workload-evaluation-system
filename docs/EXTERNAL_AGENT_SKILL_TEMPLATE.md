# 外部 Agent 最小 Skill 调用模板（MVP）

> **重要（2026-04）**：`/api/v1/agent/*` **当前未在主线 API 中挂载**。下方路径为**历史草案**，仅供未来实现时参考。  
> **现状**请改用：`POST /api/v1/auth/login` 取 JWT → `GET /api/v1/templates` / `GET /api/v1/rule-sets/active` → `POST /api/v1/estimates/calculate`（详见 `docs/LLM_API_CALLING_GUIDE.md`）。

曾规划的草案高层接口（未挂载）：

- `POST /api/v1/agent/estimate`
- `POST /api/v1/agent/session/start`
- `POST /api/v1/agent/session/{sessionId}/continue`

---

## 1) 运行前提

- API 地址：`http://localhost:3000`（默认）
- 说明：如需外网联调，请先启动临时隧道并将下方 URL 批量替换为当前可用地址
- 已有可用账号（JWT 登录）——**必须是本项目独立注册的账号，不得复用历史 `external-agent` 共享管理员账号（已废弃，见下）**
- 外部 Agent 支持 HTTP 调用与状态分流

> **`external-agent` 账号已废弃（2026-08-29 裁决，纯文档标注）**
>
> - 该账号（admin 角色）此前只存在于 `config/auth/users.json`；阶段 2 **S1 已删除 users 域 JSON 路径**
>   （commit `aabe222`，users.json 归档并移出 git 跟踪），2026-08-29 全域普查实取：
>   文件侧 40 条账号中**只有 `external-agent` 这一个非测试账号未进 PostgreSQL**，
>   故它**当前无法登录**（`/api/v1/auth/login` 返回 `invalid_credentials`，业务码 40001）。
> - 处置口径：与 `00_项目治理/里程碑与计划/阶段2-存储切换-实施计划.md` §4.11 S1 行已登记的
>   结论一致——36 个 JSON 账号在 PG 中不存在、**项目侧已确认无真人需要访问**。
>   `external-agent` 正式废弃：不补数据迁移、不恢复进 PG、不再作为任何文档/脚本的默认凭据。
> - 需要外部 Agent 接入时：由 admin 在系统管理页**生成邀请码**→ 注册一个**独立账号**（按需给最小权限）
>   → 用该账号登录取 JWT。共享 admin 凭据不对外发放，以保证调用可追溯到具体身份。

---

## 2) 最小系统提示词（可直接放到 Agent）

```text
你是工作量评估系统的 API 调用助手。

规则：
1) 先登录拿 JWT（Bearer）。
2) 拉取模板与规则集，构造完整 `POST /api/v1/estimates/calculate` 请求（或先 `POST /api/v1/sessions/start` 再会话计算）。
3) 若业务返回 400，根据 `details[].field/reason` 修正参数后重试。
4) 成功时输出权威 `totalDays` 与结果摘要；不要编造未返回的字段。
5) 保留并透传 `requestId` 便于排障。
```

---

## 3) HTTP 调用模板

### 3.1 登录拿 token

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username":"<USERNAME>",
    "password":"<PASSWORD>"
  }'
```

从响应中提取 `accessToken`（若你的响应字段名不同，以实际返回为准）。

### 3.2 单次高层估算（推荐入口）

```bash
curl -s -X POST http://localhost:3000/api/v1/agent/estimate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "userMessage":"帮我评估一个实施项目",
    "hints": {
      "userCount": 80,
      "difficultyFactor": 0.1
    }
  }'
```

### 3.3 会话模式（多轮追问）

```bash
curl -s -X POST http://localhost:3000/api/v1/agent/session/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "userMessage":"先开始会话"
  }'
```

拿到 `sessionId` 后：

```bash
curl -s -X POST http://localhost:3000/api/v1/agent/session/<SESSION_ID>/continue \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "userMessage":"补充参数",
    "hints": {
      "orgCount": 2,
      "orgSimilarityFactor": 0.8
    }
  }'
```

---

## 4) 响应分流策略（核心）

### `status=success`

- 读取 `data.estimate.totalDays`
- 向用户输出：
  - 估算结果
  - 关键假设（`assumptions`）
  - 追踪号（`requestId`）

### `status=needs_clarification`

- 读取 `nextQuestions[]`
- 逐条向用户提问，收集答案写入 `hints`
- 若有 `sessionId`，调用 `session/:sessionId/continue`；否则继续 `agent/estimate`

### `status=failed`

- 输出 `errorCode` 与 `suggestedFixes`
- 若是参数问题，允许最多 1 次自修复重试

---

## 5) 伪代码（可迁移到任意 Agent 框架）

```ts
async function runEstimate(userMessage: string, hints: Record<string, unknown>) {
  const token = await login();

  let sessionId: string | undefined;
  let payload = { userMessage, hints };

  for (let round = 0; round < 6; round += 1) {
    const resp = sessionId
      ? await post(`/api/v1/agent/session/${sessionId}/continue`, payload, token)
      : await post(`/api/v1/agent/estimate`, payload, token);

    const data = resp.data;

    if (data.status === "success") {
      return {
        totalDays: data.estimate.totalDays,
        assumptions: data.assumptions || [],
        requestId: resp.requestId
      };
    }

    if (data.status === "failed") {
      throw new Error(`${data.errorCode}: ${(data.suggestedFixes || []).join("; ")}`);
    }

    // needs_clarification
    sessionId = data.sessionId || sessionId;
    const answers = await askUserByQuestions(data.nextQuestions || []);
    payload = {
      userMessage: "补充参数",
      hints: { ...(payload.hints || {}), ...answers }
    };
  }

  throw new Error("clarification_round_limit_exceeded");
}
```

---

## 6) 建议默认值（Agent侧）

- 最大追问轮次：`6`
- 自动重试：仅对网络超时和 5xx，`2` 次指数退避
- `requestId`：全链路日志必须记录
- 当 `intentCandidates` 存在时：
  - `score >= 0.9` 自动采用
  - `0.7 ~ 0.9` 让用户确认
  - `< 0.7` 必须追问

