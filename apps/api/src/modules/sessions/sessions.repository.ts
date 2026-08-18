import { SessionEstimateContext } from "../../types";

const sessionStore = new Map<string, SessionEstimateContext>();

/** 阶段 1 批 6：签名改 async，实现不动（仍为内存 Map），阶段 2 替换实现。 */
export async function cleanupExpiredSessions(nowMs = Date.now()): Promise<void> {
  for (const [sessionId, ctx] of sessionStore.entries()) {
    if (ctx.expiresAt <= nowMs) {
      sessionStore.delete(sessionId);
    }
  }
}

/** 阶段 1 批 6：签名改 async，实现不动（仍为内存 Map），阶段 2 替换实现。 */
export async function saveSession(ctx: SessionEstimateContext): Promise<void> {
  sessionStore.set(ctx.sessionId, ctx);
}

/** 阶段 1 批 6：签名改 async，实现不动（仍为内存 Map），阶段 2 替换实现。 */
export async function getSession(sessionId: string): Promise<SessionEstimateContext | undefined> {
  return sessionStore.get(sessionId);
}
