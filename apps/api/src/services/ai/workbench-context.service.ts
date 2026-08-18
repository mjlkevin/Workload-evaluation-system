// ============================================================
// WES Agent Phase 1G — AI 工作台上下文构建器
// 收敛当前用户、附件、Harness artifact、可见项目摘要，
// 不让业务处理层直接读取前端状态或跨 owner 数据。
// ============================================================

import type { AuthUser } from "../../types";
import { listProjectEvaluationsForUser } from "../../modules/project-evaluations/project-evaluations.usecase";

export type WorkbenchAttachmentContext = {
  name: string;
  size?: number;
  type?: string;
  parsedSummary?: string;
};

export type WorkbenchHarnessArtifactContext = {
  harnessRunId?: string;
  artifactType?: string;
  content?: unknown;
};

export type WorkbenchProjectSummary = {
  projectId: string;
  projectName: string;
  customerName: string;
  currentStage: string;
  status: string;
  aiDraftReviewStatus?: "pending" | "confirmed";
  updatedAt: string;
};

export type WorkbenchContext = {
  user: { id: string; username: string; role: string; capabilities: string[] };
  attachment?: WorkbenchAttachmentContext;
  latestHarnessArtifact?: WorkbenchHarnessArtifactContext;
  visibleProjects: WorkbenchProjectSummary[];
  contextRefs: string[];
};

/**
 * 构建 AI 工作台上下文。
 * WES 数据查询复用 listProjectEvaluationsForUser，保证 owner 隔离。
 * 阶段 1 批 4：级联改 async（listProjectEvaluationsForUser 异步化），实现不动。
 */
export async function buildWorkbenchContext(input: {
  user: AuthUser;
  attachment?: WorkbenchAttachmentContext | null;
  latestHarnessArtifact?: WorkbenchHarnessArtifactContext | null;
}): Promise<WorkbenchContext> {
  const contextRefs: string[] = [];

  if (input.attachment?.name) {
    contextRefs.push(`attachment:${input.attachment.name}`);
  }

  if (input.latestHarnessArtifact?.harnessRunId) {
    contextRefs.push(`harness:${input.latestHarnessArtifact.harnessRunId}`);
  }

  // 查询 owner 可见项目（listProjectEvaluationsForUser 已按 user.id 过滤）
  let visibleProjects: WorkbenchProjectSummary[] = [];
  try {
    visibleProjects = (await listProjectEvaluationsForUser(input.user))
      .slice(0, 8)
      .map((project) => ({
        projectId: project.projectId,
        projectName: project.projectName,
        customerName: project.customerName,
        currentStage: project.currentStage,
        status: project.status,
        aiDraftReviewStatus: project.aiDraftReviewStatus,
        updatedAt: project.updatedAt,
      }));
    contextRefs.push(...visibleProjects.map((project) => `project:${project.projectId}`));
  } catch {
    // 查询失败时返回空列表，不阻塞意图分发
    visibleProjects = [];
  }

  return {
    user: {
      id: input.user.id,
      username: input.user.username,
      role: input.user.role,
      capabilities: [], // AuthUser 没有 capabilities 字段，预留为空
    },
    attachment: input.attachment ?? undefined,
    latestHarnessArtifact: input.latestHarnessArtifact ?? undefined,
    visibleProjects,
    contextRefs,
  };
}
