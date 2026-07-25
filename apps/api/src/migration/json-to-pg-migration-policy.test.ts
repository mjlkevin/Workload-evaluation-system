import test from "node:test";
import assert from "node:assert/strict";

import type { VersionCodeRulesStore } from "../types";
import { buildJsonToPgMigrationPlan } from "./json-to-pg-migration-plan";

test("json-to-pg migration plan discards user, token, version history, team, ai session and trace JSON", () => {
  const plan = buildJsonToPgMigrationPlan({
    users: { users: [{ id: "legacy-user", username: "legacy" }] as any[] },
    inviteCodes: { codes: [{ code: "OLD-CODE" }] as any[] },
    passwordResetTokens: { tokens: [{ id: "legacy-token" }] as any[] },
    versionRecords: { records: [{ id: "legacy-record", versionCode: "GL-OLD" }] as any[] },
    team: { version: 9, teams: [{ teamId: "legacy-team" }], reviews: [], comments: [], planBindings: [], auditLogs: [] } as any,
    aiSessions: { sessions: [{ sessionId: "legacy-session" }] as any[] },
    traces: { version: 1, traces: [{ traceId: "legacy-trace" }] as any[] },
    versionCodeRules: { rules: [] },
    template: null,
    ruleSet: null,
    systemConfigs: {},
  });

  assert.deepEqual(plan.discardedSources.map((item) => [item.source, item.count]), [
    ["users", 1],
    ["inviteCodes", 1],
    ["passwordResetTokens", 1],
    ["versionRecords", 1],
    ["team.teams", 1],
    ["team.reviews", 0],
    ["team.comments", 0],
    ["team.planBindings", 0],
    ["team.auditLogs", 0],
    ["aiSessions", 1],
    ["traces", 1],
  ]);

  assert.deepEqual(plan.resetTables, [
    "users",
    "invite_codes",
    "password_reset_tokens",
    "version_records",
    "teams",
    "team_members",
    "team_reviews",
    "team_review_comments",
    "team_plan_bindings",
    "team_audit_logs",
    "ai_sessions",
    "traces",
  ]);
  assert.deepEqual(plan.upserts.versionRecords, []);
  assert.deepEqual(plan.upserts.users, []);
});

test("json-to-pg migration plan preserves rule, template, rule set and system config payloads exactly", () => {
  const versionCodeRules = {
    rules: [
      {
        id: "rule-global",
        moduleKey: "global",
        moduleName: "总方案",
        moduleCode: "GL",
        prefix: "GL",
        format: "{PREFIX}-{YYYYMMDD}-{NNN}",
        sample: "GL-20260704-001",
        status: "active",
        effectiveAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z",
      },
      {
        id: "rule-wbs",
        moduleKey: "wbs",
        moduleName: "WBS",
        moduleCode: "WBS",
        prefix: "WBS",
        format: "{PREFIX}-{YYYYMM}-{NNN}",
        sample: "WBS-202607-001",
        status: "draft",
        effectiveAt: "--",
        updatedAt: "2026-07-04T00:00:00.000Z",
      },
    ],
  } satisfies VersionCodeRulesStore;
  const template = {
    templateId: "tmpl-1",
    templateVersion: "v1",
    templateName: "模板",
    groups: [{ groupId: "g1", groupName: "分组" }],
    items: [{ templateItemId: "i1", groupId: "g1", itemName: "事项", standardDays: 1 }],
    sheets: [{ sheetId: "s1", sheetName: "Sheet1" }],
  };
  const ruleSet = {
    ruleSetId: "rs-1",
    ruleVersion: "v1",
    pipelineVersion: "p1",
    pipeline: ["base"],
    baseRule: { userCountTiers: [{ min: 1, max: 10, factor: 0.1 }], difficultyFactorList: [0.2] },
    orgIncrementRule: { enabled: true, factor: 0.5 },
  };
  const systemConfigs = {
    requirementSettings: { version: 2, draft: { a: 1 }, active: { a: 2 }, updatedAt: "u", effectiveAt: "e" },
    implementationDependencyRules: { version: 3, draft: { b: 1 }, active: { b: 2 }, updatedAt: "u2", effectiveAt: "e2" },
    knowledgeBaseConfig: { version: 4, draft: { c: 1 }, active: { c: 2 }, updatedAt: "u3", effectiveAt: "e3" },
  };

  const plan = buildJsonToPgMigrationPlan({
    users: { users: [] },
    inviteCodes: { codes: [] },
    passwordResetTokens: { tokens: [] },
    versionRecords: { records: [] },
    team: { version: 0, teams: [], reviews: [], comments: [], planBindings: [], auditLogs: [] },
    aiSessions: { sessions: [] },
    traces: { version: 1, traces: [] },
    versionCodeRules,
    template,
    ruleSet,
    systemConfigs,
  });

  assert.deepEqual(plan.upserts.versionCodeRules, versionCodeRules.rules);
  assert.deepEqual(plan.upserts.templates, [template]);
  assert.deepEqual(plan.upserts.ruleSets, [ruleSet]);
  assert.deepEqual(plan.upserts.systemConfigs, [
    { key: "requirementSettings", store: systemConfigs.requirementSettings },
    { key: "implementationDependencyRules", store: systemConfigs.implementationDependencyRules },
    { key: "knowledgeBaseConfig", store: systemConfigs.knowledgeBaseConfig },
  ]);
});
