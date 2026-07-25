import test from "node:test";
import assert from "node:assert/strict";

import { validateStructuredValue } from "./structured-output";
import {
  ATTACHMENT_ANALYSIS_CONTRACT,
  CHANGE_MANAGEMENT_DIFF_CONTRACT,
  COMPANY_PROFILE_CONTRACT,
  DEV_ASSESSMENT_DRAFT_CONTRACT,
  INTERACTIVE_FORM_BLOCK_CONTRACT,
  REQUIREMENT_IMPORT_CONTRACT,
} from "./wes-contracts";

test("COMPANY_PROFILE_CONTRACT: 接受完整画像输出", () => {
  const result = validateStructuredValue(COMPANY_PROFILE_CONTRACT, {
    needsDisambiguation: false,
    candidates: [],
    enterpriseProfile: "某制造企业",
    location: "深圳",
    customerIndustry: "制造业",
    enterpriseRevenue: "未公开",
    itStatus: "ERP 建设中",
  });

  assert.equal(result.valid, true);
});

test("COMPANY_PROFILE_CONTRACT: 需要消歧时拒绝缺少 displayName 的候选", () => {
  const result = validateStructuredValue(COMPANY_PROFILE_CONTRACT, {
    needsDisambiguation: true,
    candidates: [{ summary: "深圳主体" }],
    enterpriseProfile: "",
    location: "",
    customerIndustry: "",
    enterpriseRevenue: "",
    itStatus: "",
  });

  assert.equal(result.valid, false);
  if (!result.valid) assert.ok(result.issues.some((issue) => /displayName/.test(issue.path + issue.message)));
});

test("ATTACHMENT_ANALYSIS_CONTRACT: 拒绝把 needs 输出成字符串", () => {
  const result = validateStructuredValue(ATTACHMENT_ANALYSIS_CONTRACT, {
    answer: "已分析",
    projectName: "项目A",
    customerName: "客户A",
    industry: "制造业",
    productLines: [],
    sourceSheets: [],
    needs: "采购优化",
    modules: [],
    missingItems: [],
    risks: [],
    nextActions: [],
    summary: "摘要",
    sourceFiles: [],
  });

  assert.equal(result.valid, false);
});

test("DEV_ASSESSMENT_DRAFT_CONTRACT: 拒绝负数编码人天", () => {
  const result = validateStructuredValue(DEV_ASSESSMENT_DRAFT_CONTRACT, {
    items: [{ index: 0, codingDays: -1, basis: "无效" }],
  });
  assert.equal(result.valid, false);
});

test("CHANGE_MANAGEMENT_DIFF_CONTRACT: 拒绝缺少 modified 数组", () => {
  const result = validateStructuredValue(CHANGE_MANAGEMENT_DIFF_CONTRACT, {
    diffResult: { added: [], removed: [] },
    newEstimate: null,
  });
  assert.equal(result.valid, false);
});

test("INTERACTIVE_FORM_BLOCK_CONTRACT: 单选字段必须有选项", () => {
  const result = validateStructuredValue(INTERACTIVE_FORM_BLOCK_CONTRACT, {
    blockId: "clarification",
    title: "补充信息",
    submitLabel: "提交",
    fields: [{ id: "scope", label: "范围", type: "single_select" }],
  });
  assert.equal(result.valid, false);
});

test("REQUIREMENT_IMPORT_CONTRACT: 拒绝缺少需求数据根节点", () => {
  const result = validateStructuredValue(REQUIREMENT_IMPORT_CONTRACT, {
    basicInfo: {},
  });
  assert.equal(result.valid, false);
});
