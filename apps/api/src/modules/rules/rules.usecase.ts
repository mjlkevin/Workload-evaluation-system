import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import { RuleSetMeta, isRuleSetLike } from "../../types";
import { ok, fail } from "../../utils/response";
import { requireAuth, requireRole } from "../../middleware/auth";
import { loadRuleSet, saveRuleSet } from "./rules.repository";

export function getActiveRuleSet(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const ruleSet = loadRuleSet();
  res.json(ok(ruleSet));
}

export function getRuleSetMeta(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const ruleSet = loadRuleSet();
  const meta: RuleSetMeta = {
    grouping: ["group by groupId from template.items"],
    itemRule: ["included ? standardDays : 0"],
    baseRule: ruleSet.baseRule,
    orgIncrementRule: ruleSet.orgIncrementRule,
    pipeline: ruleSet.pipeline
  };
  res.json(ok(meta));
}

export function importRuleSetJson(req: Request, res: Response) {
  if (!requireRole(req, res, ["admin"])) return;

  const requestId = randomUUID();
  const input = req.body;

  if (!isRuleSetLike(input)) {
    return fail(res, 40001, "参数错误", [{ field: "ruleSet", reason: "invalid_structure" }]);
  }

  saveRuleSet(input);
  res.json(
    ok(
      {
        ruleSetId: input.ruleSetId,
        ruleVersion: input.ruleVersion,
        pipelineVersion: input.pipelineVersion
      },
      requestId
    )
  );
}
