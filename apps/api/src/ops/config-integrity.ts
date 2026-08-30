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
  // 阶段 2 S1（2026-08-25）：users.json 已切 PG 并移出 git 跟踪（归档至 99_归档/），
  // 不再列入完整性检查（否则 repair 模式会重建空文件，形成误导性双源）；
  // 文件本体删除归 S7 收尾批。
  // 阶段 2 批 1 第 4 步：invite-codes.json 已切 PG 并归档，不再列入完整性检查
  // （否则 fallback 会重建空文件，形成误导性双源）。
  // 阶段 2 S5（2026-08-30）：config/teams/store.json 随 teams 域 JSON 读写路径删除
  // 一并摘除（沿用 S1 先例的理由：teams 已恒 PG，保留条目会使 repair 重建一个
  // 六数组空结构的文件，形成误导性双源）。
  // 阶段 2 S4（2026-08-30）：config/versions/records.json 随 versions 域 JSON
  // 读写路径删除一并摘除（同 S1/S5 理由：已恒 PG，保留条目会使 repair 重建
  // {records: []} 空文件，形成误导性双源）。
  // 【摘完后本表为空】——REQUIRED_FILES 已无可检查对象，runConfigIntegrityCheck
  // 退化为「恒 ok、checked 0 files」的空跑。本模块整体下线（含 main.ts 启动期
  // 调用点、ops:config:check 脚本、no-sync-store-io 白名单 #1 的 4 处命中）
  // 已具备条件，按 D15 归 S7 收尾批执行，本批不越范围动它。
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
