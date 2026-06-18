import type { HistoryProjectRow } from "../../db/schema";

export interface SimilarProjectResult {
  project: HistoryProjectRow;
  similarityScore: number;
  estimatedActualDiff: {
    daysDiff?: number;
    costDiff?: number;
  };
}
import {
  createHistoryProject,
  findHistoryProjectById,
  updateHistoryProject,
  deleteHistoryProject,
  listHistoryProjects,
  listAllHistoryProjects,
  type CreateHistoryProjectInput,
  type UpdateHistoryProjectInput,
  type ListHistoryProjectsOpts,
} from "./history.repository";

function computeIndustryScore(recordIndustry: string, queryIndustry: string): number {
  const r = recordIndustry.trim();
  const q = queryIndustry.trim();
  if (!r || !q) return 0;
  if (r === q) return 50;
  if (r.includes(q) || q.includes(r)) return 30;
  return 0;
}

function computeScaleScore(recordScale: string, queryScale: string): number {
  const r = recordScale.trim();
  const q = queryScale.trim();
  if (!r || !q) return 0;

  const keywords = ["集团", "500", "1000", "大型", "300", "中型", "100", "小型", "50"];
  let score = 0;
  for (const kw of keywords) {
    const hasInR = r.includes(kw);
    const hasInQ = q.includes(kw);
    if (hasInR && hasInQ) {
      if (/^\d+$/.test(kw)) {
        const rMatch = new RegExp(`(^|\\D)${kw}(\\D|$)`).test(r);
        const qMatch = new RegExp(`(^|\\D)${kw}(\\D|$)`).test(q);
        if (rMatch && qMatch) score += 20;
      } else {
        score += 20;
      }
    }
  }
  return score;
}

function computeModuleOverlap(recordModules: unknown, queryModules: string[]): number {
  const recMods = Array.isArray(recordModules) ? (recordModules as string[]) : [];
  if (!recMods.length || !queryModules.length) return 0;
  const recSet = new Set(recMods.map((m) => String(m).trim()));
  let overlap = 0;
  for (const m of queryModules) {
    if (recSet.has(m.trim())) overlap++;
  }
  return overlap * 5;
}

function computeSimilarity(
  project: HistoryProjectRow,
  industry: string,
  scale: string,
  modules: string[],
): number {
  return (
    computeIndustryScore(project.industry, industry) +
    computeScaleScore(project.scale, scale) +
    computeModuleOverlap(project.modules, modules)
  );
}

function computeEstimatedActualDiff(project: HistoryProjectRow): SimilarProjectResult["estimatedActualDiff"] {
  const diff: SimilarProjectResult["estimatedActualDiff"] = {};
  if (typeof project.actualDays === "number" && typeof project.estimatedDays === "number") {
    diff.daysDiff = project.actualDays - project.estimatedDays;
  }
  if (typeof project.actualCost === "number" && typeof project.estimatedCost === "number") {
    diff.costDiff = project.actualCost - project.estimatedCost;
  }
  return diff;
}

export function closeProject(input: CreateHistoryProjectInput): Promise<HistoryProjectRow> {
  return createHistoryProject(input);
}

export function getProject(id: string): Promise<HistoryProjectRow | null> {
  return findHistoryProjectById(id);
}

export function updateProject(id: string, input: UpdateHistoryProjectInput): Promise<HistoryProjectRow | null> {
  return updateHistoryProject(id, input);
}

export function removeProject(id: string): Promise<boolean> {
  return deleteHistoryProject(id);
}

export function listProjects(opts: ListHistoryProjectsOpts): Promise<HistoryProjectRow[]> {
  return listHistoryProjects(opts);
}

export async function findSimilarProjects(
  industry: string,
  scale: string,
  modules: string[],
  topN = 5,
): Promise<SimilarProjectResult[]> {
  const allProjects = await listAllHistoryProjects();

  const scored = allProjects.map((project) => {
    const similarityScore = computeSimilarity(project, industry, scale, modules);
    return {
      project,
      similarityScore,
      estimatedActualDiff: computeEstimatedActualDiff(project),
    };
  });

  scored.sort((a, b) => b.similarityScore - a.similarityScore);
  return scored.filter((s) => s.similarityScore > 0).slice(0, topN);
}
