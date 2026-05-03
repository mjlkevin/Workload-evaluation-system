// ============================================================
// Prometheus Metrics 基座
// ============================================================
// 导出 prom-client 默认注册表 + 自定义业务指标

import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from "prom-client";

// 默认注册表
export const register = new Registry();

// 收集 Node.js 默认指标（GC、事件循环、内存等）
collectDefaultMetrics({ register });

// ---------- HTTP 请求总量 ----------
export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

// ---------- HTTP 请求耗时（Histogram） ----------
export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// ---------- DB 查询耗时 ----------
export const dbQueryDurationSeconds = new Histogram({
  name: "db_query_duration_seconds",
  help: "Database query duration in seconds",
  labelNames: ["operation"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

// ---------- AI Provider 请求总量 ----------
export const aiProviderRequestsTotal = new Counter({
  name: "ai_provider_requests_total",
  help: "Total number of AI provider requests",
  labelNames: ["provider", "status"],
  registers: [register],
});
