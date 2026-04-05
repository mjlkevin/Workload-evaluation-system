import { Router } from "express";
import { randomUUID } from "node:crypto";

import { requireRoleWithAuth } from "../middleware/auth";
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

router.get("/", (req, res) => {
  const auth = requireRoleWithAuth(req, res, ["admin", "operator"]);
  if (!auth) return;

  const store = loadVersionsStore();
  const globals = store.records
    .filter((record) => record.ownerUserId === auth.user.id && record.type === "global")
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)));

  const latest = globals[0];
  if (!latest) {
    return res.json(ok([]));
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

  const items: WbsItem[] = steps.map((step, idx) => ({
    id: randomUUID(),
    moduleKey: step.key,
    taskName: `${project} - ${step.title}`,
    owner: auth.user.username,
    linkedVersionCode: step.linkedVersion,
    sourceGlobalVersionCode: latest.versionCode,
    sourceGlobalRecordId: latest.id,
    isDerived: true,
    start: toDate(idx * 7),
    end: toDate(idx * 7 + 6),
    status: step.linkedVersion ? "已完成" : idx === 0 ? "进行中" : "未开始"
  }));

  return res.json(ok(items));
});

export default router;
