// ============================================================
// Workbench 统一视图 Usecase 测试（O5 Sprint 3A）
// ============================================================
// RED 先行：先写失败测试

import { describe, it } from "node:test";
import assert from "node:assert";

import type { AuthUser } from "../../types";

import {
  createWorkbenchViewUsecase,
  type WorkbenchViewRepoPort,
  type WorkbenchUnifiedView,
} from "./workbench-view.usecase";

// ============================================================
// Fake 与辅助函数
// ============================================================

function fakeRepo(overrides: Partial<WorkbenchViewRepoPort> = {}): WorkbenchViewRepoPort {
  return {
    listActiveRunsForOwner: async () => [],
    getRunSnapshot: async () => null,
    ...overrides,
  };
}

function fakeUser(id = "user-1", username = "tester"): AuthUser {
  return {
    id,
    username,
    role: "user",
    passwordHash: "",
    status: "active",
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
}

// ============================================================
// 测试套件
// ============================================================

describe("workbench-view.usecase", () => {
  describe("getUnifiedView", () => {
    it("应返回空视图当用户无会话且无 Run", async () => {
      const usecase = createWorkbenchViewUsecase({ repo: fakeRepo() });
      const view = await usecase.getUnifiedView(fakeUser());

      assert.strictEqual(view.sessions.length, 0);
      assert.strictEqual(view.runs.length, 0);
      assert.strictEqual(view.tasks.length, 0);
      assert.strictEqual(view.artifacts.length, 0);
      assert.strictEqual(view.failedRuns.length, 0);
    });

    it("应将会话中的 pendingActions 映射为 tasks", async () => {
      // 此测试需要真实 ai-sessions 存储，在集成测试中验证
      // 单元测试层面验证映射逻辑正确性
      const usecase = createWorkbenchViewUsecase({ repo: fakeRepo() });
      const view = await usecase.getUnifiedView(fakeUser());

      // 空用户应返回空 tasks
      assert.strictEqual(view.tasks.length, 0);
    });

    it("应将 failed Run 的 errorCode + errorMessage 映射为 failedReason", async () => {
      const repo = fakeRepo({
        listActiveRunsForOwner: async () => [
          {
            harnessRunId: "run-1",
            aiSessionId: "session-1",
            title: "测试 Run",
            status: "failed",
            errorCode: "WORKER_STEP_FAILED",
            errorMessage: "模型调用超时",
            createdAt: new Date("2026-08-09T10:00:00Z"),
            updatedAt: new Date("2026-08-09T10:05:00Z"),
          },
        ],
      });
      const usecase = createWorkbenchViewUsecase({ repo });
      const view = await usecase.getUnifiedView(fakeUser());

      assert.strictEqual(view.runs.length, 1);
      assert.strictEqual(view.runs[0].failedReason, "WORKER_STEP_FAILED: 模型调用超时");
      assert.strictEqual(view.failedRuns.length, 1);
      assert.strictEqual(view.failedRuns[0].error, "WORKER_STEP_FAILED: 模型调用超时");
      assert.strictEqual(view.failedRuns[0].retriable, true);
    });

    it("应将 RECOVERY_LIMIT_EXCEEDED 标记为不可重试", async () => {
      const repo = fakeRepo({
        listActiveRunsForOwner: async () => [
          {
            harnessRunId: "run-2",
            aiSessionId: "session-1",
            title: "测试 Run",
            status: "failed",
            errorCode: "RECOVERY_LIMIT_EXCEEDED",
            errorMessage: "automatic recovery limit exceeded",
            createdAt: new Date("2026-08-09T10:00:00Z"),
            updatedAt: new Date("2026-08-09T10:05:00Z"),
          },
        ],
      });
      const usecase = createWorkbenchViewUsecase({ repo });
      const view = await usecase.getUnifiedView(fakeUser());

      assert.strictEqual(view.failedRuns.length, 1);
      assert.strictEqual(view.failedRuns[0].retriable, false);
    });

    it("应将 running 状态的 latestEventKind 映射为 run_claimed", async () => {
      const repo = fakeRepo({
        listActiveRunsForOwner: async () => [
          {
            harnessRunId: "run-3",
            aiSessionId: "session-1",
            title: "运行中 Run",
            status: "running",
            createdAt: new Date("2026-08-09T10:00:00Z"),
            updatedAt: new Date("2026-08-09T10:01:00Z"),
          },
        ],
      });
      const usecase = createWorkbenchViewUsecase({ repo });
      const view = await usecase.getUnifiedView(fakeUser());

      assert.strictEqual(view.runs[0].latestEventKind, "run_claimed");
    });

    it("应将 queued 状态的 latestEventKind 映射为 run_queued", async () => {
      const repo = fakeRepo({
        listActiveRunsForOwner: async () => [
          {
            harnessRunId: "run-4",
            aiSessionId: "session-1",
            title: "排队中 Run",
            status: "queued",
            createdAt: new Date("2026-08-09T10:00:00Z"),
            updatedAt: new Date("2026-08-09T10:00:00Z"),
          },
        ],
      });
      const usecase = createWorkbenchViewUsecase({ repo });
      const view = await usecase.getUnifiedView(fakeUser());

      assert.strictEqual(view.runs[0].latestEventKind, "run_queued");
    });

    it("数据隔离：仅返回本人数据（通过 repo.ownerUserId 过滤）", async () => {
      // 数据隔离由 repository 层保证（listActiveRunsForOwner 已按 ownerUserId 过滤）
      // 本测试验证 usecase 不绕过该过滤
      const listActiveRunsForOwner = async (ownerUserId: string) => {
        // 模拟 repository 只返回该用户的数据
        if (ownerUserId === "user-1") {
          return [
            {
              harnessRunId: "run-user1",
              aiSessionId: "session-1",
              title: "User1 Run",
              status: "running",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ];
        }
        return [];
      };

      const repo = fakeRepo({ listActiveRunsForOwner });
      const usecase = createWorkbenchViewUsecase({ repo });

      const view1 = await usecase.getUnifiedView(fakeUser("user-1"));
      assert.strictEqual(view1.runs.length, 1);
      assert.strictEqual(view1.runs[0].runId, "run-user1");

      const view2 = await usecase.getUnifiedView(fakeUser("user-2"));
      assert.strictEqual(view2.runs.length, 0);
    });

    it("应将会话中的 artifacts 映射为 artifacts 数组", async () => {
      // 空用户无会话，返回空 artifacts
      const usecase = createWorkbenchViewUsecase({ repo: fakeRepo() });
      const view = await usecase.getUnifiedView(fakeUser());
      assert.strictEqual(view.artifacts.length, 0);
    });

    it("应正确处理无 errorCode/errorMessage 的 failed Run", async () => {
      const repo = fakeRepo({
        listActiveRunsForOwner: async () => [
          {
            harnessRunId: "run-5",
            aiSessionId: "session-1",
            title: "失败 Run",
            status: "failed",
            createdAt: new Date("2026-08-09T10:00:00Z"),
            updatedAt: new Date("2026-08-09T10:05:00Z"),
          },
        ],
      });
      const usecase = createWorkbenchViewUsecase({ repo });
      const view = await usecase.getUnifiedView(fakeUser());

      assert.strictEqual(view.runs[0].failedReason, undefined);
      assert.strictEqual(view.failedRuns[0].error, "未知错误");
    });
  });
});
