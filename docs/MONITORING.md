# 监控基座文档（Monitoring）

> 目标：让运维能看到 API 健不健康、跑得慢不慢、出没出错。  
> 三大支柱：**Health（健康检查）** / **Log（结构化日志）** / **Metrics（Prometheus 指标）**

---

## 一、端点清单

| 端点 | 鉴权 | 说明 |
|------|------|------|
| `GET /health` | ❌ 无需 | Liveness Probe。返回 `{ status: "ok", uptime, version }` |
| `GET /health/ready` | ❌ 无需 | Readiness Probe。检查 DB 连通 + Kimi API 可达，返回 `{ db: "ok", kimi: "ok", ready: true }` |
| `GET /health/info` | ❌ 无需 | 构建信息。返回 `{ version, commitHash, buildTime, nodeEnv }` |
| `GET /metrics` | ❌ 无需 / 可选 `METRICS_TOKEN` | Prometheus scrape 端点，返回 text format |

> 运维探针（Kubernetes / Docker / Cloudflare）直接访问上述端点即可，无需 Token。

---

## 二、日志

### 2.1 配置

- **生产环境**：JSON 输出（pino 默认）
- **开发环境**：`pino-pretty` 彩色美化输出

### 2.2 每条日志字段

```json
{
  "level": "info",
  "time": "2026-05-02T14:30:00.000Z",
  "requestId": "uuid",
  "route": "GET /api/v1/versions",
  "method": "GET",
  "url": "/api/v1/versions",
  "msg": "200 ← GET /api/v1/versions (42ms)"
}
```

### 2.3 生产环境日志查询示例（jq）

```bash
# 只看 error 级别
kubectl logs -f deployment/workload-api | jq 'select(.level == "error")'

# 按 requestId 追踪一次完整请求链
kubectl logs -f deployment/workload-api | jq 'select(.requestId == "xxxx")'

# 统计最近 1 分钟的 5xx 数量
kubectl logs deployment/workload-api --since=1m | jq -s 'map(select(.status >= 500)) | length'

# 慢请求（>500ms）
kubectl logs deployment/workload-api | jq 'select(.durationMs > 500) | {route, durationMs, requestId}'
```

---

## 三、Prometheus 指标

### 3.1 默认指标（Node.js 运行时）

由 `prom-client` 的 `collectDefaultMetrics` 提供，包括：

- `process_cpu_user_seconds_total`
- `process_cpu_system_seconds_total`
- `process_resident_memory_bytes`
- `nodejs_eventloop_lag_seconds`
- `nodejs_gc_duration_seconds`
- ……

### 3.2 自定义业务指标

| 指标名 | 类型 | Labels | 说明 |
|--------|------|--------|------|
| `http_requests_total` | Counter | `method`, `route`, `status` | 各接口请求总量 |
| `http_request_duration_seconds` | Histogram | `method`, `route` | 各接口请求耗时分布（秒） |
| `db_query_duration_seconds` | Histogram | `operation` | 数据库查询耗时分布（秒） |
| `ai_provider_requests_total` | Counter | `provider`, `status` | AI 厂商调用总量（`success` / `error`） |

### 3.3 Scrape 配置示例

```yaml
# prometheus.yml
scrape_configs:
  - job_name: "workload-api"
    static_configs:
      - targets: ["api:3000"]
    metrics_path: "/metrics"
    scrape_interval: 15s
```

### 3.4 常用 PromQL 查询

```promql
# 每秒 QPS（按 route）
sum by (route) (rate(http_requests_total[1m]))

# P95 响应延迟
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))

# DB 查询 P99 延迟
histogram_quantile(0.99, sum by (le) (rate(db_query_duration_seconds_bucket[5m])))

# AI 调用成功率
sum(rate(ai_provider_requests_total{status="success"}[5m]))
/
sum(rate(ai_provider_requests_total[5m]))
```

---

## 四、推荐 Grafana Dashboard（JSON 摘要）

可导入以下 Panel 配置到 Grafana：

```json
{
  "title": "Workload API Overview",
  "panels": [
    {
      "title": "QPS",
      "targets": [
        {
          "expr": "sum by (route) (rate(http_requests_total[1m]))"
        }
      ],
      "type": "timeseries"
    },
    {
      "title": "P95 Latency",
      "targets": [
        {
          "expr": "histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))"
        }
      ],
      "type": "timeseries"
    },
    {
      "title": "AI Provider Success Rate",
      "targets": [
        {
          "expr": "sum(rate(ai_provider_requests_total{status=\"success\"}[5m])) / sum(rate(ai_provider_requests_total[5m]))"
        }
      ],
      "type": "stat"
    },
    {
      "title": "DB Query Latency",
      "targets": [
        {
          "expr": "histogram_quantile(0.99, sum by (le) (rate(db_query_duration_seconds_bucket[5m])))"
        }
      ],
      "type": "timeseries"
    }
  ]
}
```

> 完整 JSON 可在 Grafana UI 中导出保存为 `workload-api-dashboard.json`，后续迭代补充。

---

## 五、环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LOG_LEVEL` | `info` | pino 日志级别（`trace`/`debug`/`info`/`warn`/`error`/`fatal`） |
| `METRICS_TOKEN` | `""` | `/metrics` 访问 Token（空字符串表示不校验） |
| `GIT_COMMIT_HASH` | `unknown` | 构建时注入的 commit hash |
| `BUILD_TIME` | `启动时间` | 构建时注入的时间戳 |
