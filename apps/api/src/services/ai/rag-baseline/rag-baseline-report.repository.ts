import fs from "node:fs";
import path from "node:path";

const SENSITIVE_FIELD_PATTERN = /api[_-]?key|authorization|token|secret|password|cookie|private[_-]?key/i;
const SENSITIVE_TEXT_PATTERN = /bearer\s+[a-z0-9._~+/=-]+/ig;

export type SaveRagBaselineArtifactOptions = {
  projectRoot?: string;
  outputDirectory?: string;
  datasetVersion: string;
  now?: Date;
};

function sanitizeArtifact(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sanitizeArtifact);
  if (input && typeof input === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_PATTERN.test(key)) continue;
      output[key] = sanitizeArtifact(value);
    }
    return output;
  }
  if (typeof input === "string") return input.replace(SENSITIVE_TEXT_PATTERN, "[REDACTED]");
  return input;
}

function compactIso(now: Date): string {
  return now.toISOString().replace(/[-:.]/g, "");
}

export function defaultRagReportDirectory(projectRoot = process.cwd()): string {
  return path.join(projectRoot, "data", "rag-baseline-reports");
}

export function saveRagBaselineArtifact(
  artifact: unknown,
  options: SaveRagBaselineArtifactOptions,
): string {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const allowedDirectory = path.resolve(defaultRagReportDirectory(projectRoot));
  const outputDirectory = path.resolve(options.outputDirectory || allowedDirectory);
  if (outputDirectory !== allowedDirectory) throw new Error("report_output_directory_not_allowed");
  const datasetVersion = String(options.datasetVersion || "").trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!datasetVersion) throw new Error("dataset_version_required");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const filePath = path.join(outputDirectory, `${datasetVersion}-${compactIso(options.now || new Date())}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(sanitizeArtifact(artifact), null, 2)}\n`, "utf8");
  return filePath;
}
