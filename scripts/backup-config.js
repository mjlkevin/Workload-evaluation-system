#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function resolveRootDir() {
  return path.resolve(__dirname, "..");
}

function copyDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function main() {
  const rootDir = resolveRootDir();
  const configDir = path.resolve(rootDir, "config");
  if (!fs.existsSync(configDir)) {
    throw new Error("config 目录不存在，无法备份");
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.resolve(rootDir, "backups", "config", day, stamp);
  copyDirectory(configDir, backupRoot);

  const logsDir = path.resolve(rootDir, "logs");
  const logFile = path.resolve(logsDir, "data-anomaly-repair.log");
  fs.mkdirSync(logsDir, { recursive: true });
  const line = JSON.stringify({
    at: now.toISOString(),
    source: "scheduled",
    type: "repair",
    file: "config/*",
    message: `backup_created:${backupRoot}`,
  });
  fs.appendFileSync(logFile, `${line}\n`, "utf-8");

  console.log(`[backup-config] done: ${backupRoot}`);
}

main();
