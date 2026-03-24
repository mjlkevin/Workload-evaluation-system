const fs = require("node:fs");
const path = require("node:path");

function readRuleSet(rootDir) {
  const rulePath = path.resolve(rootDir, "config/rules/example-rule-set.json");
  return JSON.parse(fs.readFileSync(rulePath, "utf-8"));
}

function calcUserIncrementByRule(baseDays, userCount, ruleSet) {
  const tier =
    ruleSet.baseRule.userCountTiers.find((x) => userCount >= x.min && userCount <= x.max) || {
      min: 0,
      max: 0,
      factor: 0
    };
  const raw = baseDays * tier.factor;
  return ruleSet.baseRule.userIncrementRounding === "ceil_int" ? Math.ceil(raw) : Math.round(raw * 10) / 10;
}

function calcUserIncrementByExcel(baseDays, userCount) {
  if (userCount <= 50) return 0;
  if (userCount < 71) return Math.ceil(baseDays * 0.05);
  if (userCount < 91) return Math.ceil(baseDays * 0.1);
  if (userCount < 131) return Math.ceil(baseDays * 0.15);
  if (userCount < 1001) return Math.ceil(baseDays * 0.25);
  return Math.ceil(baseDays * 0.25);
}

function calcOrgIncrementByRule(baseDays, orgCount, similarity, ruleSet) {
  if (!ruleSet.orgIncrementRule.enabled) return 0;
  const factor = Number(ruleSet.orgIncrementRule.factor ?? 0.1);
  const raw = baseDays * Math.max(0, orgCount - 1) * (1 - similarity) * factor;
  return Math.round(raw * 10) / 10;
}

function calcOrgIncrementByExcel(baseDays, orgCount, g215) {
  const extraOrgCount = Math.max(0, orgCount - 1);
  return Math.round(baseDays * extraOrgCount * g215 * 10) / 10;
}

function assertEqual(title, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${title} failed: actual=${actual}, expected=${expected}`);
  }
}

function main() {
  const rootDir = process.cwd();
  const ruleSet = readRuleSet(rootDir);
  const baseDaysCases = [8, 100, 998];
  const userCountCases = [0, 50, 51, 70, 71, 90, 91, 130, 131, 999];
  const orgCountCases = [1, 2, 3, 5];
  const g215 = Number(ruleSet.orgIncrementRule.factor ?? 0.1);

  for (const baseDays of baseDaysCases) {
    for (const userCount of userCountCases) {
      const actual = calcUserIncrementByRule(baseDays, userCount, ruleSet);
      const expected = calcUserIncrementByExcel(baseDays, userCount);
      assertEqual(`userIncrement(base=${baseDays},user=${userCount})`, actual, expected);
    }
  }

  // Excel公式不含相似度参数，使用 similarity=0 对齐对比。
  for (const baseDays of baseDaysCases) {
    for (const orgCount of orgCountCases) {
      const actual = calcOrgIncrementByRule(baseDays, orgCount, 0, ruleSet);
      const expected = calcOrgIncrementByExcel(baseDays, orgCount, g215);
      assertEqual(`orgIncrement(base=${baseDays},org=${orgCount})`, actual, expected);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: {
          userIncrementCases: baseDaysCases.length * userCountCases.length,
          orgIncrementCases: baseDaysCases.length * orgCountCases.length
        }
      },
      null,
      2
    )
  );
}

main();
