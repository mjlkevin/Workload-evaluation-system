# 外部 Agent 最小 Skill 调用模板（MVP）

用于让第三方 Agent（不登录 Web）直接调用本系统高层 API：

- `POST /api/v1/agent/estimate`
- `POST /api/v1/agent/session/start`
- `POST /api/v1/agent/session/{sessionId}/continue`

---

## 1) 运行前提

- API 地址：`http://localhost:3000`（默认）
- 说明：如需外网联调，请先启动临时隧道并将下方 URL 批量替换为当前可用地址
- 已有可用账号（JWT 登录）
- 外部 Agent 支持 HTTP 调用与状态分流

---

## 2) 最小系统提示词（可直接放到 Agent）

```text
你是工作量评估系统的 API 调用助手。

规则：
1) 先登录拿 JWT（Bearer）。
2) 优先调用 /api/v1/agent/estimate 或 /api/v1/agent/session/*。
3) 若返回 status=needs_clarification，必须按 nextQuestions 向用户追问并继续调用 continue。
4) 若返回 status=success，直接输出 estimate.totalDays，并附 assumptions 摘要。
5) 若返回 status=failed，输出 errorCode 与 suggestedFixes，不要编造结果。
6) 保留并透传 requestId 便于排障。
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

