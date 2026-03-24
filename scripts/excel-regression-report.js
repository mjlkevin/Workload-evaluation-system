const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

function round1(value) {
  return Math.round(value * 10) / 10;
}

function resolveSheetName(workbook, expectedName) {
  const normalized = expectedName.trim();
  return workbook.SheetNames.find((name) => name.trim() === normalized) || workbook.SheetNames[0];
}

function parseUserTiersFromFormula(formula) {
  const baseMatch = formula.match(/D211<=([0-9]+),0/);
  if (!baseMatch) {
    throw new Error("cannot_parse_base_user_tier");
  }
  const baseMax = Number(baseMatch[1]);
  const tiers = [{ min: 0, max: baseMax, factor: 0 }];
  const regex = /D211<([0-9]+),INT\(\(J210\*([0-9.]+)\+0\.99\)\)/g;

  let match;
  let previousMax = baseMax;
  while ((match = regex.exec(formula)) !== null) {
    const exclusiveUpper = Number(match[1]);
    const factor = Number(match[2]);
    tiers.push({ min: previousMax + 1, max: exclusiveUpper - 1, factor });
    previousMax = exclusiveUpper - 1;
  }
  return tiers;
}

function parseBaseDaysFromSheet(worksheet) {
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: true });
  const toText = (value) => String(value ?? "").trim();
  let sum = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const colB = toText(row[1]);
    const colC = toText(row[2]);
    const colD = toText(row[3]);
    const colG = Number(row[6]);
    if (!Number.isFinite(colG) || colG <= 0) continue;
    const itemName = colD || colC;
    if (!itemName || itemName.includes("工作量") || itemName.includes("小计") || itemName.includes("合计")) continue;
    const groupName = colB || colC || "未分组";
    if (groupName.includes("工作量") || groupName.includes("小计") || groupName.includes("合计")) continue;
    sum += colG;
  }
  return round1(sum);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function calcByRule(baseDays, userCount, difficultyFactor, orgCount, orgSimilarityFactor, ruleSet) {
  const tier =
    ruleSet.baseRule.userCountTiers.find((x) => userCount >= x.min && userCount <= x.max) || {
      min: 0,
      max: 0,
      factor: 0
    };
  const userRaw = baseDays * tier.factor;
  const userIncrementDays =
    ruleSet.baseRule.userIncrementRounding === "ceil_int" ? Math.ceil(userRaw) : round1(userRaw);
  const difficultyIncrementDays = round1(baseDays * difficultyFactor);
  const orgFactor = Number(ruleSet.orgIncrementRule.factor ?? 0.1);
  const orgIncrementDays = ruleSet.orgIncrementRule.enabled
    ? round1(baseDays * Math.max(0, orgCount - 1) * (1 - orgSimilarityFactor) * orgFactor)
    : 0;
  const totalDays = round1(baseDays + userIncrementDays + difficultyIncrementDays + orgIncrementDays);
  return { userIncrementDays, difficultyIncrementDays, orgIncrementDays, totalDays };
}

function calcByExcel(baseDays, userCount, difficultyFactor, orgCount, orgSimilarityFactor, orgFactor) {
  let userIncrementDays = 0;
  if (userCount <= 50) userIncrementDays = 0;
  else if (userCount < 71) userIncrementDays = Math.ceil(baseDays * 0.05);
  else if (userCount < 91) userIncrementDays = Math.ceil(baseDays * 0.1);
  else if (userCount < 131) userIncrementDays = Math.ceil(baseDays * 0.15);
  else userIncrementDays = Math.ceil(baseDays * 0.25);
  const difficultyIncrementDays = round1(baseDays * difficultyFactor);
  const orgIncrementDays = round1(baseDays * Math.max(0, orgCount - 1) * (1 - orgSimilarityFactor) * orgFactor);
  const totalDays = round1(baseDays + userIncrementDays + difficultyIncrementDays + orgIncrementDays);
  return { userIncrementDays, difficultyIncrementDays, orgIncrementDays, totalDays };
}

function main() {
  const rootDir = process.cwd();
  const excelPath = path.resolve(
    rootDir,
    "01_需求管理/原始需求/金蝶AI星空-实施人天估算-R202602-V1.0（0303版本）.xlsx"
  );
  const rulePath = path.resolve(rootDir, "config/rules/example-rule-set.json");
  const reportDir = path.resolve(rootDir, "05_测试与质量/测试报告");
  const reportJsonPath = path.resolve(reportDir, "excel-regression-report.json");
  const reportMdPath = path.resolve(reportDir, "excel-regression-report.md");

  const workbook = XLSX.readFile(excelPath, { cellFormula: true });
  const sheetName = resolveSheetName(workbook, "模块报价");
  const ws = workbook.Sheets[sheetName];
  const ruleSet = JSON.parse(fs.readFileSync(rulePath, "utf-8"));

  const excelBaseDays = Number(ws.J210?.v ?? 0);
  const parsedBaseDays = parseBaseDaysFromSheet(ws);
  const baseDaysDelta = round1(Math.abs(parsedBaseDays - excelBaseDays));

  const excelUserTiers = parseUserTiersFromFormula(String(ws.F211?.f || ""));
  const ruleUserTiers = ruleSet.baseRule.userCountTiers || [];
  const userTierMatch = deepEqual(excelUserTiers, ruleUserTiers);
  const excelOrgFactor = Number(ws.G215?.v ?? 0.1);
  const ruleOrgFactor = Number(ruleSet.orgIncrementRule.factor ?? 0.1);
  const orgFactorMatch = Math.abs(excelOrgFactor - ruleOrgFactor) < 1e-9;
  const difficultyMatch = deepEqual(ruleSet.baseRule.difficultyFactorList || [], [0, 0.1, 0.2, 0.3]);
  const roundingMatch = ruleSet.baseRule.userIncrementRounding === "ceil_int";

  const scenarioCases = [
    { userCount: 50, difficultyFactor: 0, orgCount: 1, orgSimilarityFactor: 1 },
    { userCount: 51, difficultyFactor: 0, orgCount: 1, orgSimilarityFactor: 1 },
    { userCount: 90, difficultyFactor: 0.1, orgCount: 2, orgSimilarityFactor: 0.6 },
    { userCount: 130, difficultyFactor: 0.2, orgCount: 3, orgSimilarityFactor: 0.6 },
    { userCount: 131, difficultyFactor: 0.3, orgCount: 3, orgSimilarityFactor: 0.3 }
  ];
  const scenarioResults = scenarioCases.map((scenario) => {
    const byRule = calcByRule(
      excelBaseDays,
      scenario.userCount,
      scenario.difficultyFactor,
      scenario.orgCount,
      scenario.orgSimilarityFactor,
      ruleSet
    );
    const byExcel = calcByExcel(
      excelBaseDays,
      scenario.userCount,
      scenario.difficultyFactor,
      scenario.orgCount,
      scenario.orgSimilarityFactor,
      excelOrgFactor
    );
    return {
      ...scenario,
      byRule,
      byExcel,
      pass: deepEqual(byRule, byExcel)
    };
  });

  const checks = [
    { name: "用户分段规则一致", pass: userTierMatch },
    { name: "难度系数枚举一致", pass: difficultyMatch },
    { name: "用户增量取整一致", pass: roundingMatch },
    { name: "多组织系数一致", pass: orgFactorMatch },
    { name: "模板基准人天接近Excel(J210)", pass: baseDaysDelta <= 0.2 }
  ];
  const allPass = checks.every((x) => x.pass) && scenarioResults.every((x) => x.pass);

  const report = {
    generatedAt: new Date().toISOString(),
    excelFile: path.basename(excelPath),
    sheetName,
    checks,
    metrics: {
      excelBaseDays,
      parsedBaseDays,
      baseDaysDelta,
      excelOrgFactor,
      ruleOrgFactor
    },
    scenarioResults,
    pass: allPass
  };

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), "utf-8");

  const mdLines = [
    "# Excel 规则回归报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- Excel文件：${report.excelFile}`,
    `- 工作表：${report.sheetName}`,
    `- 结论：${allPass ? "PASS" : "FAIL"}`,
    "",
    "## 核心检查",
    ...checks.map((item) => `- ${item.pass ? "[PASS]" : "[FAIL]"} ${item.name}`),
    "",
    "## 指标",
    `- Excel基准人天(J210)：${excelBaseDays}`,
    `- 解析基准人天：${parsedBaseDays}`,
    `- 差异：${baseDaysDelta}`,
    `- 多组织系数(Excel G215)：${excelOrgFactor}`,
    `- 多组织系数(规则)：${ruleOrgFactor}`,
    "",
    "## 样本场景对比",
    "| userCount | difficulty | orgCount | similarity | byRule.total | byExcel.total | pass |",
    "|---:|---:|---:|---:|---:|---:|:---:|",
    ...scenarioResults.map(
      (r) =>
        `| ${r.userCount} | ${r.difficultyFactor} | ${r.orgCount} | ${r.orgSimilarityFactor} | ${r.byRule.totalDays} | ${r.byExcel.totalDays} | ${r.pass ? "PASS" : "FAIL"} |`
    )
  ];
  fs.writeFileSync(reportMdPath, mdLines.join("\n"), "utf-8");

  console.log(JSON.stringify({ ok: true, pass: allPass, reportJsonPath, reportMdPath }, null, 2));
}

main();
