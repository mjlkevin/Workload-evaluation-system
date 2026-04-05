import fs from "node:fs";
import path from "node:path";

import { resolveRootDir } from "../utils/file";

type IntegritySource = "startup" | "manual" | "scheduled";

type IntegrityIssue = {
  file: string;
  reason: string;
  severity: "warn" | "error";
};

type IntegrityResult = {
  ok: boolean;
  checkedFiles: string[];
  issues: IntegrityIssue[];
};

const REQUIRED_FILES: Array<{
  relativePath: string;
  validate: (value: unknown) => boolean;
  fallback: unknown;
}> = [
  {
    relativePath: "config/auth/users.json",
    validate: (value) => typeof value === "object" && value !== null && Array.isArray((value as { users?: unknown[] }).users),
    fallback: { users: [] },
  },
  {
    relativePath: "config/auth/invite-codes.json",
    validate: (value) => typeof value === "object" && value !== null && Array.isArray((value as { codes?: unknown[] }).codes),
    fallback: { codes: [] },
  },
  {
    relativePath: "config/versions/records.json",
    validate: (value) => typeof value === "object" && value !== null && Array.isArray((value as { records?: unknown[] }).records),
    fallback: { records: [] },
  },
  {
    relativePath: "config/teams/store.json",
    validate: (value) =>
      typeof value === "object" &&
      value !== null &&
      Array.isArray((value as { teams?: unknown[] }).teams) &&
      Array.isArray((value as { reviews?: unknown[] }).reviews) &&
      Array.isArray((value as { comments?: unknown[] }).comments) &&
      Array.isArray((value as { planBindings?: unknown[] }).planBindings) &&
      Array.isArray((value as { auditLogs?: unknown[] }).auditLogs),
    fallback: { version: 1, teams: [], reviews: [], comments: [], planBindings: [], auditLogs: [] },
  },
];

function appendDataOpsLog(event: {
  source: IntegritySource;
  type: "anomaly" | "repair";
  file: string;
  message: string;
}): void {
  const rootDir = resolveRootDir();
  const logsDir = path.resolve(rootDir, "logs");
  const logFile = path.resolve(logsDir, "data-anomaly-repair.log");
  fs.mkdirSync(logsDir, { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), ...event });
  fs.appendFileSync(logFile, `${line}\n`, "utf-8");
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
}

export function runConfigIntegrityCheck(source: IntegritySource = "manual", repair = false): IntegrityResult {
  const rootDir = resolveRootDir();
  const issues: IntegrityIssue[] = [];
  const checkedFiles: string[] = [];

  for (const entry of REQUIRED_FILES) {
    const filePath = path.resolve(rootDir, entry.relativePath);
    checkedFiles.push(entry.relativePath);

    if (!fs.existsSync(filePath)) {
      const reason = "missing_file";
      issues.push({ file: entry.relativePath, reason, severity: "error" });
      appendDataOpsLog({ source, type: "anomaly", file: entry.relativePath, message: reason });

      if (repair) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(entry.fallback, null, 2), "utf-8");
        appendDataOpsLog({ source, type: "repair", file: entry.relativePath, message: "created_with_fallback" });
      }
      continue;
    }

    try {
      const content = readJsonFile(filePath);
      if (!entry.validate(content)) {
        const reason = "invalid_schema";
        issues.push({ file: entry.relativePath, reason, severity: "error" });
        appendDataOpsLog({ source, type: "anomaly", file: entry.relativePath, message: reason });

        if (repair) {
          fs.writeFileSync(filePath, JSON.stringify(entry.fallback, null, 2), "utf-8");
          appendDataOpsLog({ source, type: "repair", file: entry.relativePath, message: "reset_to_fallback" });
        }
      }
    } catch {
      const reason = "invalid_json";
      issues.push({ file: entry.relativePath, reason, severity: "error" });
      appendDataOpsLog({ source, type: "anomaly", file: entry.relativePath, message: reason });

      if (repair) {
        fs.writeFileSync(filePath, JSON.stringify(entry.fallback, null, 2), "utf-8");
        appendDataOpsLog({ source, type: "repair", file: entry.relativePath, message: "recreated_after_parse_error" });
      }
    }
  }

  return { ok: issues.length === 0, checkedFiles, issues };
}
