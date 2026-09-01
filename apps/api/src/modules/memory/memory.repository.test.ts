// ============================================================
// SP-2026-007 · MS2（M2 会话记忆分层蒸馏）
// memory.repository.test — 记忆 repository 单元测试
// ============================================================
// 使用 node:test + node:assert，不依赖 vitest
// 需要可用 PostgreSQL（TEST_DATABASE_URL || DATABASE_URL）；缺失时跳过
// S3B1（2026-09-01，台账 B4 分诊）：接入 test:modules。cleanup 原为整表 delete
// （违 C5 数据集隔离），改为 ownerUserId 前缀 + 条件 DELETE；测试数据带随机
// 前缀，与共享测试库其他数据集互不干扰。

import assert from "node:assert/strict";
import { after, afterEach, before, test, describe } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { memoryAtoms, memoryScenes } from "../../db/schema";
import { createMemoryRepository } from "./memory.repository";
import type { DistillOutput } from "./memory.types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

// 条件 skip：无 DB 时跳过全部
const maybeSkip = TEST_DATABASE_URL ? describe : describe.skip;

maybeSkip("memory.repository (requires DB)", () => {
  let db: ReturnType<typeof drizzle>;
  let pool: Pool;
  let repo: ReturnType<typeof createMemoryRepository>;

  // 随机前缀隔离（C5）：与共享测试库其他数据集互不干扰；条件 DELETE 只清本前缀
  const ownerUserId = "memtest-" + randomUUID();
  const projectId = "memtest-proj-" + randomUUID();
  const harnessRunId = randomUUID();

  const sampleDistill: DistillOutput = {
    atoms: [
      { factKey: "customer_name", factText: "客户名称为小鹏汽车", confidence: 95 },
      { factKey: "project_scope", factText: "项目范围包含 ERP 实施", confidence: 88 },
    ],
    scenes: [
      { sceneTitle: "初次需求沟通", sceneSummary: "客户表达了 ERP 实施的核心诉求", atomKeys: ["customer_name", "project_scope"] },
    ],
  };

  async function cleanup() {
    if (!db) return;
    // C5 数据集隔离：按 ownerUserId 前缀条件删除，禁止整表 delete
    await db.delete(memoryScenes).where(eq(memoryScenes.ownerUserId, ownerUserId));
    await db.delete(memoryAtoms).where(eq(memoryAtoms.ownerUserId, ownerUserId));
  }

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    db = drizzle(pool);
    repo = createMemoryRepository(db);
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  after(async () => {
    await cleanup();
    if (pool) await pool.end();
  });

  test("should save distilled memory with atoms and scenes", async () => {
    const result = await repo.saveDistilledMemory({
      ownerUserId,
      projectId,
      harnessRunId,
      distill: sampleDistill,
    });

    assert.equal(result.atoms.length, 2);
    assert.equal(result.scenes.length, 1);
    assert.equal(result.atoms[0].factKey, "customer_name");
    assert.equal(result.atoms[0].status, "draft");
    assert.equal(result.scenes[0].sceneTitle, "初次需求沟通");
    assert.equal(result.scenes[0].status, "draft");
  });

  test("should list memory for project", async () => {
    await repo.saveDistilledMemory({
      ownerUserId,
      projectId,
      harnessRunId,
      distill: sampleDistill,
    });
    const list = await repo.listMemoryForProject({ ownerUserId, projectId });
    assert.ok(list.atoms.length >= 2);
    assert.ok(list.scenes.length >= 1);
    assert.ok(list.totalAtoms >= 2);
    assert.ok(list.totalScenes >= 1);
  });

  test("should confirm atom and scene", async () => {
    await repo.saveDistilledMemory({
      ownerUserId,
      projectId,
      harnessRunId: randomUUID(),
      distill: sampleDistill,
    });
    const list = await repo.listMemoryForProject({ ownerUserId, projectId });
    const atom = list.atoms[0];
    const scene = list.scenes[0];

    const confirmedAtom = await repo.confirmMemoryAtom(atom.memoryAtomId, ownerUserId);
    assert.ok(confirmedAtom);
    assert.equal(confirmedAtom.status, "active");

    const confirmedScene = await repo.confirmMemoryScene(scene.memorySceneId, ownerUserId);
    assert.ok(confirmedScene);
    assert.equal(confirmedScene.status, "active");
  });

  test("should archive atom and scene", async () => {
    await repo.saveDistilledMemory({
      ownerUserId,
      projectId,
      harnessRunId: randomUUID(),
      distill: sampleDistill,
    });
    const list = await repo.listMemoryForProject({ ownerUserId, projectId, status: "draft" });
    const atom = list.atoms[0];
    const scene = list.scenes[0];

    const archivedAtom = await repo.archiveMemoryAtom(atom.memoryAtomId, ownerUserId);
    assert.ok(archivedAtom);
    assert.equal(archivedAtom.status, "archived");

    const archivedScene = await repo.archiveMemoryScene(scene.memorySceneId, ownerUserId);
    assert.ok(archivedScene);
    assert.equal(archivedScene.status, "archived");
  });

  test("should get active scenes and atoms for project", async () => {
    await repo.saveDistilledMemory({
      ownerUserId,
      projectId,
      harnessRunId: randomUUID(),
      distill: sampleDistill,
    });

    const list = await repo.listMemoryForProject({ ownerUserId, projectId });
    await repo.confirmMemoryAtom(list.atoms[0].memoryAtomId, ownerUserId);
    await repo.confirmMemoryScene(list.scenes[0].memorySceneId, ownerUserId);

    const activeScenes = await repo.getActiveScenesForProject(ownerUserId, projectId, 5);
    assert.ok(activeScenes.length >= 1);

    const activeAtoms = await repo.getActiveAtomsForProject(ownerUserId, projectId, 5);
    assert.ok(activeAtoms.length >= 1);
  });

  test("should not confirm atom with wrong owner", async () => {
    await repo.saveDistilledMemory({
      ownerUserId,
      projectId,
      harnessRunId: randomUUID(),
      distill: sampleDistill,
    });
    const list = await repo.listMemoryForProject({ ownerUserId, projectId });
    const result = await repo.confirmMemoryAtom(list.atoms[0].memoryAtomId, "wrong-user");
    assert.equal(result, null);
  });

  test("should handle empty distill gracefully", async () => {
    const runId = randomUUID();
    const result = await repo.saveDistilledMemory({
      ownerUserId,
      projectId,
      harnessRunId: runId,
      distill: { atoms: [], scenes: [] },
    });
    assert.equal(result.atoms.length, 0);
    assert.equal(result.scenes.length, 0);
  });
});
