import assert from "node:assert/strict";
import { test } from "node:test";
import XLSX from "xlsx";

import { mergeRequirementImportData, parseRequirementImportFromWorkbook } from "./ai-workbook";

test("产品及模块：产品分组 + 应用列 + 中间自定义列 + 末尾用户数（首行填数向下沿用）", () => {
  const wb = XLSX.utils.book_new();
  const rows: (string | number)[][] = [
    ["产品分组", "应用", "REC", "RILHK", "RILNS", "用户数"],
    ["财务云", "总账", "√", "√", "√", "50"],
    ["", "报表", "√", "√", "√", ""],
    ["供应链云", "采购管理", "√", "√", "√", ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "4.产品及模块信息");

  const data = parseRequirementImportFromWorkbook(wb);
  assert.equal(data.productModuleRows.length, 3);
  assert.equal(data.productModuleRows[0].productDomain, "财务云");
  assert.equal(data.productModuleRows[0].moduleName, "总账");
  assert.equal(data.productModuleRows[0].userCount, "50");
  assert.equal(data.productModuleRows[1].productDomain, "财务云");
  assert.equal(data.productModuleRows[1].moduleName, "报表");
  assert.equal(data.productModuleRows[1].userCount, "50");
  assert.equal(data.productModuleRows[2].productDomain, "供应链云");
  assert.equal(data.productModuleRows[2].moduleName, "采购管理");
  assert.equal(data.productModuleRows[2].userCount, "50");
});

test("Kimi 合并：模型返回的 productModuleRows 无有效域/模块时保留规则解析结果", () => {
  const fallback = parseRequirementImportFromWorkbook(
    (() => {
      const wb = XLSX.utils.book_new();
      const rows: (string | number)[][] = [
        ["产品分组", "应用", "用户数"],
        ["财务云", "总账", "10"],
      ];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "4.产品及模块信息");
      return wb;
    })(),
  );
  const merged = mergeRequirementImportData(
    {
      valuePropositionRows: [],
      businessNeedRows: [],
      devOverviewRows: [],
      productModuleRows: [
        {
          productDomain: "",
          moduleName: "",
          subModule: "",
          userCount: "99",
          implementationOrgCount: "",
          pilotOrgCount: "",
          partyBLead: "",
          partyALead: "",
        },
      ],
      implementationScopeRows: [],
      meetingNotes: "",
      keyPointRows: [],
    },
    fallback,
  );
  assert.equal(merged.productModuleRows.length, 1);
  assert.equal(merged.productModuleRows[0].moduleName, "总账");
  assert.equal(merged.productModuleRows[0].productDomain, "财务云");
});
