// ============================================================
// 结构化日志 - Pino
// ============================================================
// 生产环境：JSON 输出（pino 默认）
// 开发环境：pino-pretty 美化
// 每条日志含：timestamp / level / requestId / userId / route / msg

import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

const transport = isDev
  ? {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    }
  : undefined;

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  // 开发环境移除基字段，让 pretty 输出更紧凑
  ...(isDev ? {} : {}),
});

/** 为当前请求创建带上下文的 child logger */
export function childLogger(
  bindings: Record<string, unknown> = {}
): pino.Logger {
  return logger.child(bindings);
}
