import assert from "node:assert/strict";
import test from "node:test";

// Capability contracts verified against controllers, mounted routes and repositories.
// Keep this test independent of runtime modules: importing them can initialize PostgreSQL.
import { STATE_MACHINE_CATALOG } from "./state-machines.catalog";

function descriptor(id: string) {
  const found = STATE_MACHINE_CATALOG.find((item) => item.id === id);
  assert.ok(found, `missing descriptor ${id}`);
  return found;
}

function statusAxis(id: string) {
  const found = descriptor(id).axes.find((axis) => axis.key === "status");
  assert.ok(found, `missing status axis ${id}`);
  return found;
}

function implementedTransition(id: string, from: string, to: string) {
  const found = statusAxis(id).transitions.find((item) => item.from === from && item.to === to);
  assert.ok(found, `${id}: missing ${from}->${to}`);
  assert.equal(found.implemented, true, `${id}: ${from}->${to} is implemented`);
  return found;
}

// patchBrief/updateBrief, patchMessage/updateMessage and updateVersionStatus only
// validate the next value; no previous-status condition blocks any of these pairs.
for (const { id, statuses, endpoint } of [
  { id: "sales_briefing", statuses: ["open", "converted", "abandoned"], endpoint: "PATCH /api/v1/sales/briefs/:id" },
  { id: "collab_question", statuses: ["open", "resolved", "closed"], endpoint: "PATCH /api/v1/collab/messages/:messageId" },
  { id: "version_document", statuses: ["draft", "reviewed", "published", "archived"], endpoint: "PATCH /api/v1/versions/:recordId/status" },
]) {
  test(`state-machines capabilities: ${id} supports every distinct valid status pair`, () => {
    for (const from of statuses) {
      assert.notEqual(statusAxis(id).statuses.find((item) => item.key === from)?.terminal, true, `${id}.${from} can transition out`);
      for (const to of statuses.filter((value) => value !== from)) {
        assert.equal(implementedTransition(id, from, to).trigger, endpoint);
      }
    }
  });
}

test("state-machines capabilities: team review can close and reopen; invalid status is rejected", () => {
  // team.usecase.updateReviewStatus rejects invalid values before loading the team.
  assert.notEqual(statusAxis("team_review").statuses.find((item) => item.key === "closed")?.terminal, true);
  for (const [from, to] of [["open", "closed"], ["closed", "open"]]) {
    const transition = implementedTransition("team_review", from, to);
    assert.equal(transition.trigger, "PATCH /api/v1/teams/:teamId/reviews/:reviewId/status");
    assert.match(transition.guard, /42201/);
    assert.match(transition.guard, /open\|closed/);
    assert.match(transition.guard, /manager/);
  }
});

test("state-machines capabilities: memory confirm restores archived rows; draft and active can archive", () => {
  // memory.controller mounts four batch POSTs; repository updates filter id + ownerUserId only.
  assert.notEqual(statusAxis("memory").statuses.find((item) => item.key === "archived")?.terminal, true);
  for (const [from, to, action] of [
    ["draft", "active", "confirm"], ["archived", "active", "confirm"],
    ["draft", "archived", "archive"], ["active", "archived", "archive"],
  ]) {
    const transition = implementedTransition("memory", from, to);
    for (const kind of ["atoms", "scenes"]) {
      assert.ok(transition.trigger.includes(`POST /api/v1/memory/${kind}/${action}`));
    }
    assert.match(transition.guard, /ownerUserId/);
    assert.match(transition.guard, /memoryIds/);
  }
});

test("state-machines capabilities: knowledge repository can return active to draft but cannot restore archived", () => {
  // KnowledgePgRepository.update rejects archived rows, then applies patch.status directly.
  assert.equal(statusAxis("knowledge_entry").initial, "active");
  const reverse = implementedTransition("knowledge_entry", "active", "draft");
  assert.match(reverse.trigger, /KnowledgePgRepository\.update/);
  assert.match(reverse.guard, /KNOWLEDGE_ENTRY_ARCHIVED/);
  assert.equal(statusAxis("knowledge_entry").statuses.find((item) => item.key === "archived")?.terminal, true);
  assert.equal(statusAxis("knowledge_entry").transitions.some((item) => item.from === "archived" && item.to !== "archived" && item.implemented), false);
  for (const from of ["draft", "active"]) {
    assert.ok(implementedTransition("knowledge_entry", from, "archived").trigger.includes("POST /api/v1/knowledge/entries/:entryId/archive"));
  }
});

test("state-machines capabilities: session creation and artifact append do not implement existing-status transitions", () => {
  // createAiSession accepts an initial status; appendSessionEvent only concatenates JSONB arrays.
  // An appended artifact with the same artifactId does not replace the existing artifact.
  for (const id of ["ai_session", "ai_artifact"]) {
    assert.ok(statusAxis(id).transitions.length > 0);
    assert.equal(statusAxis(id).transitions.some((item) => item.implemented), false, `${id}: no existing-status update path`);
    assert.equal(statusAxis(id).statuses.some((item) => item.terminal), false, `${id}: no enforced terminal status contract`);
  }
});

test("state-machines capabilities: change actions include the mounted change prefix", () => {
  for (const [to, action] of [["merged", "merge"], ["rejected", "reject"]]) {
    assert.equal(implementedTransition("change_submission", "submitted", to).trigger, `POST /api/v1/change/change-submissions/:id/${action}`);
  }
});
