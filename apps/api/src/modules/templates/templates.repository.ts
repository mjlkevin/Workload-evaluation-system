import { Template } from "../../types";
import { loadJsonFile, saveJsonFile } from "../../utils/file";

const TEMPLATE_PATH = "config/templates/example-template.json";

export function loadTemplate(): Template {
  return loadJsonFile<Template>(TEMPLATE_PATH);
}

export function saveTemplate(template: Template): void {
  saveJsonFile(TEMPLATE_PATH, template);
}
