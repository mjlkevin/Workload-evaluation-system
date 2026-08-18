import { RuleSet } from "../../types";
import { loadJsonFile, saveJsonFile } from "../../utils/file";

const RULE_SET_PATH = "config/rules/example-rule-set.json";

/** 阶段 1 批 6：签名改 async，实现不动（仍为 readFileSync/writeFileSync），阶段 2 替换实现。 */
export async function loadRuleSet(): Promise<RuleSet> {
  return loadJsonFile<RuleSet>(RULE_SET_PATH);
}

/** 阶段 1 批 6：签名改 async，实现不动（仍为 readFileSync/writeFileSync），阶段 2 替换实现。 */
export async function saveRuleSet(ruleSet: RuleSet): Promise<void> {
  saveJsonFile(RULE_SET_PATH, ruleSet);
}
