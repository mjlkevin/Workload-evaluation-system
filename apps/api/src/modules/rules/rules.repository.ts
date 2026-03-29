import { RuleSet } from "../../types";
import { loadJsonFile, saveJsonFile } from "../../utils/file";

const RULE_SET_PATH = "config/rules/example-rule-set.json";

export function loadRuleSet(): RuleSet {
  return loadJsonFile<RuleSet>(RULE_SET_PATH);
}

export function saveRuleSet(ruleSet: RuleSet): void {
  saveJsonFile(RULE_SET_PATH, ruleSet);
}
