import { Template } from "../../types";
import { loadJsonFile, saveJsonFile } from "../../utils/file";

const TEMPLATE_PATH = "config/templates/example-template.json";

/** 阶段 1 批 6：签名改 async，实现不动（仍为 readFileSync/writeFileSync），阶段 2 替换实现。 */
export async function loadTemplate(): Promise<Template> {
  return loadJsonFile<Template>(TEMPLATE_PATH);
}

/** 阶段 1 批 6：签名改 async，实现不动（仍为 readFileSync/writeFileSync），阶段 2 替换实现。 */
export async function saveTemplate(template: Template): Promise<void> {
  saveJsonFile(TEMPLATE_PATH, template);
}
