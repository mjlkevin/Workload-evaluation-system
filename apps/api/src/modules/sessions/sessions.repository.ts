import { SessionEstimateContext } from "../../types";

const sessionStore = new Map<string, SessionEstimateContext>();

export function cleanupExpiredSessions(nowMs = Date.now()): void {
  for (const [sessionId, ctx] of sessionStore.entries()) {
    if (ctx.expiresAt <= nowMs) {
      sessionStore.delete(sessionId);
    }
  }
}

export function saveSession(ctx: SessionEstimateContext): void {
  sessionStore.set(ctx.sessionId, ctx);
}

export function getSession(sessionId: string): SessionEstimateContext | undefined {
  return sessionStore.get(sessionId);
}
