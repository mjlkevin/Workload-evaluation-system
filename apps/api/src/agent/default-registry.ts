import type { AuthUser } from "../types";
import type { RuntimeContext } from "./context/context.types";
import { ToolRegistry } from "./tool-registry";
import { buildEstimateTool } from "./tools/presales.tools";
import {
  buildEstimateHistoryTool,
  buildKnowledgeQueryTool,
  buildProjectListTool,
  buildRuleLookupTool,
} from "./tools/query.tools";
import {
  buildCreateProjectTool,
  buildExportReportTool,
  buildGenerateWbsTool,
} from "./tools/mutation.tools";
import { buildListToolsTool } from "./tools/list-tools.tools";
import { calculateEstimateOnly, listExportHistoryByOwner } from "../modules/estimates/estimates.module";
import { calculateAndExportEstimate } from "../modules/estimates/estimates.usecase";
import {
  createProjectEvaluationForUser,
  listProjectEvaluationsForUser,
} from "../modules/project-evaluations/project-evaluations.module";
import { loadRuleSet } from "../modules/rules/rules.repository";
import { resolveActiveKnowledgeBaseCatalog } from "../modules/system/system.repository";
import { queryZhipuKnowledgeBase } from "../services/ai/knowledge-tool.service";
import { buildDerivedWbsItemsForUser } from "../routes/wbs.routes";

/**
 * 默认 Agent 工具注册表（O2 · A3）：注册全部 8 个工具。
 *
 * 能力位映射说明：计划文档中的 project:read / estimate:read / knowledge:read /
 * rule:read / project:write / wbs:write / export:write 在当前 RBAC Capability
 * 联合类型中不存在；按「复用现有能力位、不改权限模型」口径，映射为与既有
 * HTTP 路由一致的现有能力位（estimates:read / estimates:create / estimates:write）。
 *
 * 数据隔离：所有底层函数在构造时闭包绑定已认证用户（ownerUserId），
 * 模型入参无法越权访问他人数据。
 */
export function createDefaultRegistry(user: AuthUser, runtime?: RuntimeContext): ToolRegistry {
  const registry = new ToolRegistry();

  // ---- 既有：实施初估（读） ----
  registry.register(
    buildEstimateTool((body) => calculateEstimateOnly(body as Parameters<typeof calculateEstimateOnly>[0])),
  );

  // ---- 查询类（A1） ----
  registry.register(
    buildProjectListTool((query) => listProjectEvaluationsForUser(user, { q: query.keyword })),
  );
  registry.register(
    buildEstimateHistoryTool((query) => listExportHistoryByOwner(user.id, query.page, query.pageSize)),
  );
  registry.register(buildKnowledgeQueryTool((query) => queryKnowledgeBase(query, runtime)));
  registry.register(buildRuleLookupTool(() => loadRuleSet()));

  // ---- 写操作类（A2，全部 mutates=true → need_confirm） ----
  registry.register(
    buildCreateProjectTool((input) => createProjectEvaluationForUser(user, { ...input })),
  );
  registry.register(
    buildGenerateWbsTool(() => ({
      items: buildDerivedWbsItemsForUser({ id: user.id, username: user.username }),
      generatedAt: new Date().toISOString(),
      // 当前 WBS 域为派生只读，无持久化层；草稿不落存储，是否补持久化待评审
      persisted: false,
    })),
  );
  registry.register(
    buildExportReportTool((body) =>
      calculateAndExportEstimate(
        body as Parameters<typeof calculateAndExportEstimate>[0],
        user.id,
        // 不传幂等键：每次导出均经用户确认，重复导出为预期行为
      ),
    ),
  );

  // ---- SP-2026-007 MS3：内置发现工具（注册在最后，全量回退时按 category=discovery 排除，
  //      保证旧 8 工具注入顺序逐字节一致；按需发现模式下常驻核心注入集） ----
  registry.register(buildListToolsTool(registry));

  return registry;
}

/** 知识库查询接线：复用生效知识库目录，未配置时由底层返回降级说明 */
async function queryKnowledgeBase(query: string, runtime?: RuntimeContext) {
  const catalog = resolveActiveKnowledgeBaseCatalog();
  const profile = catalog.profiles[0];
  return queryZhipuKnowledgeBase(query, {
    apiKey: catalog.apiKey,
    knowledgeId: profile?.knowledgeId ?? "",
    model: catalog.model,
    apiBaseUrl: catalog.apiBaseUrl,
    retrievalParams: catalog.retrievalParams,
    promptProfile: catalog.promptProfile,
    configVersion: catalog.configVersion,
    ...(runtime?.requestId ? { requestId: runtime.requestId } : {}),
  });
}
