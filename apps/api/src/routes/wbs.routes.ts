import { Router } from "express";
import { randomUUID } from "node:crypto";

import { requireAuth } from "../middleware/auth";
import { requireCapability } from "../rbac/middleware";
import { isProjectEvaluationRecord } from "../modules/project-evaluations/project-evaluations.repository";
import { loadVersionsStore } from "../modules/versions/versions.repository";
import { ok } from "../utils/response";

type WbsItem = {
  id: string;
  moduleKey: "requirementImport" | "assessment" | "dev" | "resource";
  taskName: string;
  owner: string;
  linkedVersionCode: string;
  sourceGlobalVersionCode: string;
  sourceGlobalRecordId: string;
  isDerived: true;
  start: string;
  end: string;
  status: "未开始" | "进行中" | "已完成";
};

const router = Router();

export function buildDerivedWbsItemsForUser(user: { id: string; username: string }): WbsItem[] {
  const store = loadVersionsStore();
  const globals = store.records
    .filter((record) => record.ownerUserId === user.id && record.type === "global")
    .filter((record) => !isProjectEvaluationRecord(record))
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)));

  const latest = globals[0];
  if (!latest) {
    return [];
  }

  const payload = (latest.payload || {}) as Record<string, unknown>;
  const basicInfo =
    payload.basicInfo && typeof payload.basicInfo === "object" ? (payload.basicInfo as Record<string, unknown>) : {};
  const project = String(payload.projectName || basicInfo.projectName || latest.versionCode);
  const now = new Date();
  const toDate = (offset: number) => {
    const x = new Date(now);
    x.setDate(x.getDate() + offset);
    return x.toISOString().slice(0, 10);
  };

  const steps: Array<{
    key: "requirementImport" | "assessment" | "dev" | "resource";
    title: string;
    linkedVersion: string;
  }> = [
    { key: "requirementImport", title: "需求", linkedVersion: String(payload.requirementImportVersionCode || "") },
    { key: "assessment", title: "实施评估", linkedVersion: String(payload.assessmentVersionCode || "") },
    { key: "dev", title: "开发评估", linkedVersion: String(payload.devAssessmentVersionCode || "") },
    { key: "resource", title: "资源人天及成本", linkedVersion: String(payload.resourceVersionCode || "") }
  ];

  return steps.map((step, idx) => ({
    id: randomUUID(),
    moduleKey: step.key,
    taskName: `${project} - ${step.title}`,
    owner: user.username,
    linkedVersionCode: step.linkedVersion,
    sourceGlobalVersionCode: latest.versionCode,
    sourceGlobalRecordId: latest.id,
    isDerived: true,
    start: toDate(idx * 7),
    end: toDate(idx * 7 + 6),
    status: step.linkedVersion ? "已完成" : idx === 0 ? "进行中" : "未开始"
  }));
}

router.get("/", requireCapability("estimates:read"), (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  return res.json(ok(buildDerivedWbsItemsForUser(auth.user)));
});

export default router;
