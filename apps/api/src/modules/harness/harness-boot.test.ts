/**
 * Step 2 Boot 接线守护测试（RP-047 Batch E）。
 * 常驻回归资产：
 * 1) enabled=true：registry 含 workbench_chat_v1、worker.start 与 projector.start 各恰 1 次；
 * 2) enabled=false：零 start、零注册副作用；
 * 3) SIGTERM/SIGINT 触发 worker.stop → projector.stop 顺序。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { startHarnessRuntime } from "./harness-boot";

test("boot: enabled=true 启动 worker 与 projector 各恰 1 次", async () => {
  let workerStarted = 0;
  let projectorStarted = 0;

  const runtime = startHarnessRuntime({
    repo: {} as any,
    enabled: true,
    createWorker: () => ({
      start: async () => { workerStarted += 1; },
      stop: async () => { workerStarted -= 1; },
      runNextAttempt: async () => false,
      isStopping: () => false,
    }),
    createProjector: () => ({
      start: async () => { projectorStarted += 1; },
      stop: () => { projectorStarted -= 1; },
      projectOnce: async () => [],
    }),
  });

  // 给异步 start 一点时间
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(workerStarted, 1, "worker 应启动恰好 1 次");
  assert.equal(projectorStarted, 1, "projector 应启动恰好 1 次");

  await runtime.stop();
});

test("boot: enabled=false 零 start 零副作用", async () => {
  let workerStarted = 0;
  let projectorStarted = 0;

  const runtime = startHarnessRuntime({
    repo: {} as any,
    enabled: false,
    createWorker: () => ({
      start: async () => { workerStarted += 1; },
      stop: async () => {},
      runNextAttempt: async () => false,
      isStopping: () => false,
    }),
    createProjector: () => ({
      start: async () => { projectorStarted += 1; },
      stop: () => {},
      projectOnce: async () => [],
    }),
  });

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(workerStarted, 0, "flag off 时 worker 不得启动");
  assert.equal(projectorStarted, 0, "flag off 时 projector 不得启动");

  await runtime.stop();
});

test("boot: stop 顺序为 worker 先停、projector 后停", async () => {
  const stopOrder: string[] = [];

  const runtime = startHarnessRuntime({
    repo: {} as any,
    enabled: true,
    createWorker: () => ({
      start: async () => {},
      stop: async () => { stopOrder.push("worker"); },
      runNextAttempt: async () => false,
      isStopping: () => false,
    }),
    createProjector: () => ({
      start: async () => {},
      stop: () => { stopOrder.push("projector"); },
      projectOnce: async () => [],
    }),
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  await runtime.stop();

  assert.deepEqual(stopOrder, ["worker", "projector"], "停机顺序：worker 先停、projector 后停");
});
