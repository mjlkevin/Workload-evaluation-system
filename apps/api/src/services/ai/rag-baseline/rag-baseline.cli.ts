import fs from "node:fs";
import path from "node:path";

import { resolveActiveKnowledgeBaseConfig } from "../../../modules/system/system.repository";
import type { ZhipuKnowledgeToolConfig } from "../knowledge-tool.service";
import { compareRagReports } from "./rag-baseline-comparison";
import { loadRagBaselineDataset } from "./rag-baseline-dataset";
import { saveRagBaselineArtifact } from "./rag-baseline-report.repository";
import { runRagBaseline } from "./rag-baseline-runner";

const HELP = `WES RAG baseline

Usage:
  npm run rag:baseline -w apps/api -- [--dataset <json>] [--candidate <json>]

Options:
  --dataset    评测数据集，默认 config/rag/baseline-samples.v1.json
  --candidate  仅包含 model / apiBaseUrl / retrievalParams / promptProfile 的候选配置
  --help       显示帮助，不调用外部 API

报告写入 data/rag-baseline-reports/ 并被 Git 忽略；命令不打印密钥或完整请求体。`;

function findProjectRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    const packageFile = path.join(current, "package.json");
    if (fs.existsSync(packageFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageFile, "utf8")) as { name?: string };
        if (parsed.name === "workload-evaluation-system") return current;
      } catch {
        // 继续向上寻找。
      }
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error("project_root_not_found");
    current = parent;
  }
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_argument_value:${name}`);
  return value;
}

function loadCandidate(filePath: string): Partial<ZhipuKnowledgeToolConfig> {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  const forbidden = Object.keys(parsed).find((key) => /api[_-]?key|credential|authorization|token|secret/i.test(key));
  if (forbidden) throw new Error(`candidate_contains_forbidden_field:${forbidden}`);
  const allowed = new Set(["model", "apiBaseUrl", "retrievalParams", "promptProfile"]);
  const unknown = Object.keys(parsed).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`candidate_contains_unknown_field:${unknown}`);
  return parsed as Partial<ZhipuKnowledgeToolConfig>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  const projectRoot = findProjectRoot(process.cwd());
  const datasetPath = path.resolve(projectRoot, valueAfter(args, "--dataset") || "config/rag/baseline-samples.v1.json");
  const candidateArg = valueAfter(args, "--candidate");
  const dataset = loadRagBaselineDataset(datasetPath);
  const active = resolveActiveKnowledgeBaseConfig();
  if (!active.apiKey || !active.knowledgeId) throw new Error("active_knowledge_base_credentials_missing");

  const metadata = { datasetFingerprint: dataset.fingerprint };
  const baseline = await runRagBaseline(dataset.samples, active, undefined, metadata);
  let artifact: Record<string, unknown> = { kind: "baseline", datasetVersion: dataset.version, baseline };
  let decision = "baseline_only";

  if (candidateArg) {
    const candidatePatch = loadCandidate(path.resolve(projectRoot, candidateArg));
    const candidateConfig: ZhipuKnowledgeToolConfig = { ...active, ...candidatePatch };
    const candidate = await runRagBaseline(dataset.samples, candidateConfig, undefined, metadata);
    const comparison = compareRagReports(baseline, candidate);
    decision = comparison.decision;
    artifact = { kind: "comparison", datasetVersion: dataset.version, baseline, candidate, comparison };
  }

  const reportPath = saveRagBaselineArtifact(artifact, { projectRoot, datasetVersion: dataset.version });
  console.log(`report=${reportPath}`);
  console.log(`summary=decision:${decision},samples:${baseline.sampleCount},fallback:${baseline.fallbackRate.toFixed(3)},p95Ms:${baseline.p95LatencyMs}`);
}

main().catch((error) => {
  const code = error instanceof Error ? error.message.split(":")[0] : "rag_baseline_failed";
  console.error(`rag-baseline failed: ${code}`);
  process.exitCode = 1;
});
