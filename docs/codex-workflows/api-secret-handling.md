# API Secret Handling Runbook

> 目标：验证 Napkin、智谱、Kimi 等外部 API 时，密钥不进入对话、不写入仓库、不进入看板。

## 原则

- API Key、token、cookie、私钥不得出现在用户消息、文档、看板、日志摘要或 commit 中。
- Codex 先输出参数清单、请求体和本地执行命令；密钥通过环境变量或临时终端输入传入。
- 看板和交付报告只记录脱敏结果：HTTP 状态、requestId、产物类型、字节数、耗时、错误类别。

## 推荐流程

1. Codex 给出需要的环境变量名：

```bash
export NAPKIN_API_KEY="<paste locally, do not send to chat>"
```

2. Codex 使用环境变量执行 smoke test：

```bash
curl -sS -X POST "$API_URL" \
  -H "Authorization: Bearer $NAPKIN_API_KEY" \
  -H "Content-Type: application/json" \
  --data @request.json
```

3. 记录结果时只保留：

```text
HTTP 201
requestId=<id>
status=completed
contentType=image/svg+xml
bytes=13934
secretPersisted=false
```

4. 验证结束后清理临时变量或临时文件：

```bash
unset NAPKIN_API_KEY
rm -f request.json response.json
```

## 禁止

- 不把密钥写入 `.env.example`、README、看板或 prompt 模板。
- 不把完整外部响应原文粘到看板，除非已经确认不含敏感字段。
- 不在失败日志中输出 request headers。

