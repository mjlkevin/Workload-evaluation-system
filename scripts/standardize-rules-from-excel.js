const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

function resolveSheetName(workbook, expectedName) {
  const normalized = expectedName.trim();
  return (
    workbook.SheetNames.find((name) => name.trim() === normalized) ||
    workbook.SheetNames[0]
  );
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
    const min = previousMax + 1;
    const max = exclusiveUpper - 1;
    tiers.push({ min, max, factor });
    previousMax = max;
  }

  if (tiers.length < 2) {
    throw new Error("cannot_parse_user_tiers");
  }
  return tiers;
}

function main() {
  const rootDir = process.cwd();
  const excelPath = path.resolve(
    rootDir,
    "01_需求管理/原始需求/实施评估RR/金蝶AI星空-实施人天估算-R202602-V1.0（0303版本）.xlsx"
  );
  const rulePath = path.resolve(rootDir, "config/rules/example-rule-set.json");

  if (!fs.existsSync(excelPath)) {
    throw new Error(`excel_not_found: ${excelPath}`);
  }
  if (!fs.existsSync(rulePath)) {
    throw new Error(`rule_not_found: ${rulePath}`);
  }

  const workbook = XLSX.readFile(excelPath, { cellFormula: true });
  const sheetName = resolveSheetName(workbook, "模块报价");
  const ws = workbook.Sheets[sheetName];
  if (!ws) {
    throw new Error("worksheet_not_found");
  }

  const userFormula = String(ws.F211?.f || "");
  if (!userFormula) {
    throw new Error("formula_f211_not_found");
  }
  const userCountTiers = parseUserTiersFromFormula(userFormula);
  const orgIncrementFactor = Number(ws.G215?.v ?? 0.1);

  const ruleSet = JSON.parse(fs.readFileSync(rulePath, "utf-8"));
  ruleSet.ruleVersion = `excel-std-${new Date().toISOString().slice(0, 10)}`;
  ruleSet.pipelineVersion = ruleSet.ruleVersion;
  ruleSet.baseRule = {
    ...ruleSet.baseRule,
    userCountTiers,
    difficultyFactorList: [0, 0.1, 0.2, 0.3],
    userIncrementRounding: "ceil_int"
  };
  ruleSet.orgIncrementRule = {
    ...ruleSet.orgIncrementRule,
    enabled: true,
    factor: Number.isFinite(orgIncrementFactor) ? orgIncrementFactor : 0.1
  };
  ruleSet.excelStandardization = {
    workbook: path.basename(excelPath),
    sheetName,
    extractedAt: new Date().toISOString(),
    formulaRefs: {
      userTier: "F211",
      orgFactor: "G215",
      orgIncrement: "J215=J214*I215*G215"
    }
  };

  fs.writeFileSync(rulePath, JSON.stringify(ruleSet, null, 2), "utf-8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        rulePath: path.relative(rootDir, rulePath),
        userCountTiers,
        difficultyFactorList: ruleSet.baseRule.difficultyFactorList,
        orgIncrementFactor: ruleSet.orgIncrementRule.factor
      },
      null,
      2
    )
  );
}

main();
