// ============================================================
// Collab Service 集成测试
// ============================================================
// 目标库：workload_eval_test
// 覆盖：Workspace CRUD + 成员管理 + Message CRUD + 线程 + 统计

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { testDb, truncateTestTables } from "../../test-helpers/db";
import { CollabWorkspaceService } from "./workspace";
import { CollabMessageService } from "./message";

before(async () => {
  await truncateTestTables();
});

test.afterEach(async () => {
  await testDb.execute(
    `TRUNCATE TABLE collab_workspaces, collab_messages RESTART IDENTITY CASCADE`,
  );
});

// ------------------------------------------------------------------
// CollabWorkspaceService
// ------------------------------------------------------------------

test("CollabWorkspaceService: create + findById + listByUser", async () => {
  const svc = new CollabWorkspaceService(testDb);

  const ws = await svc.create({
    name: "利民集团评估协同区",
    assessmentVersionId: randomUUID(),
    createdByUserId: "pm-01",
  });

  assert.ok(ws.workspaceId);
  assert.equal(ws.name, "利民集团评估协同区");
  assert.equal(ws.status, "active");
  assert.ok((ws.members as any[]).some((m) => m.userId === "pm-01"), "创建者自动加入成员");

  const found = await svc.findById(ws.workspaceId);
  assert.ok(found);

  const list = await svc.listByUser("pm-01");
  assert.equal(list.length, 1);
});

test("CollabWorkspaceService: addMember + removeMember", async () => {
  const svc = new CollabWorkspaceService(testDb);
  const ws = await svc.create({ name: "测试区", createdByUserId: "pm-01" });

  const updated = await svc.addMember(ws.workspaceId, {
    userId: "sales-01",
    role: "member",
    joinedAt: new Date().toISOString(),
  });
  assert.ok(updated);
  assert.ok((updated!.members as any[]).some((m) => m.userId === "sales-01"));

  const removed = await svc.removeMember(ws.workspaceId, "sales-01");
  assert.ok(removed);
  assert.ok(!(removed!.members as any[]).some((m) => m.userId === "sales-01"));
});

// ------------------------------------------------------------------
// CollabMessageService
// ------------------------------------------------------------------

test("CollabMessageService: question + reply + thread", async () => {
  const wsSvc = new CollabWorkspaceService(testDb);
  const msgSvc = new CollabMessageService(testDb);

  const ws = await wsSvc.create({ name: "测试区", createdByUserId: "pm-01" });

  const question = await msgSvc.create({
    workspaceId: ws.workspaceId,
    messageType: "question",
    senderUserId: "pmo-01",
    senderRole: "PMO",
    content: "生产管理模块的定制范围是否包含 MES 接口？",
    relatedFieldPath: "sowDocuments.productionManagement.customizationScope",
  });

  assert.ok(question.messageId);
  assert.equal(question.status, "open");
  assert.equal(question.messageType, "question");

  const reply = await msgSvc.create({
    workspaceId: ws.workspaceId,
    messageType: "reply",
    parentMessageId: question.messageId,
    senderUserId: "pre-sales-01",
    senderRole: "PRE_SALES",
    content: "是的，MES 接口对接在本次定制范围内，已与客户确认。",
  });

  assert.equal(reply.parentMessageId, question.messageId);

  const thread = await msgSvc.getThread(question.messageId);
  assert.equal(thread.length, 2);
  assert.equal(thread[0].messageId, question.messageId);
});

test("CollabMessageService: decision + update status", async () => {
  const wsSvc = new CollabWorkspaceService(testDb);
  const msgSvc = new CollabMessageService(testDb);

  const ws = await wsSvc.create({ name: "测试区", createdByUserId: "pm-01" });

  const decision = await msgSvc.create({
    workspaceId: ws.workspaceId,
    messageType: "decision",
    senderUserId: "pm-01",
    senderRole: "PM",
    content: "同意按两期实施，第一期核心模块，第二期扩展模块。",
    decisionPayload: { approved: true, phases: 2 },
  });

  assert.equal(decision.status, "resolved");

  const updated = await msgSvc.update(decision.messageId, {
    evidenceId: randomUUID(),
  });
  assert.ok(updated?.evidenceId);
});

test("CollabMessageService: listByWorkspace + countOpenQuestions", async () => {
  const wsSvc = new CollabWorkspaceService(testDb);
  const msgSvc = new CollabMessageService(testDb);

  const ws = await wsSvc.create({ name: "测试区", createdByUserId: "pm-01" });

  await msgSvc.create({ workspaceId: ws.workspaceId, messageType: "question", senderUserId: "pm-01", content: "Q1" });
  await msgSvc.create({ workspaceId: ws.workspaceId, messageType: "question", senderUserId: "pm-01", content: "Q2" });
  await msgSvc.create({ workspaceId: ws.workspaceId, messageType: "notice", senderUserId: "pm-01", content: "N1" });

  const all = await msgSvc.listByWorkspace(ws.workspaceId);
  assert.equal(all.length, 3);

  const questions = await msgSvc.listByWorkspace(ws.workspaceId, { messageType: "question" });
  assert.equal(questions.length, 2);

  const openCount = await msgSvc.countOpenQuestions(ws.workspaceId);
  assert.equal(openCount, 2);
});
