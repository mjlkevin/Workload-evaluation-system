import type { AuthUser, BusinessRole } from "../types";
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
import { buildAskUserTool } from "./tools/ask-user.tools";
import { buildDescribeCapabilitiesTool } from "./tools/capability.tools";
import { resolveBusinessRole } from "../middleware/auth";
import { routeKnowledgeBase } from "../services/ai/knowledge-base-router.service";
import type { ZhipuKnowledgeToolConfig, ZhipuKnowledgeToolTrace } from "../services/ai/knowledge-tool.service";
import { calculateEstimateOnly, listExportHistoryByOwner } from "../modules/estimates/estimates.module";
import { calculateAndExportEstimate } from "../modules/estimates/estimates.usecase";
import {
  createProjectEvaluationForUser,
  listProjectEvaluationsForUser,
} from "../modules/project-evaluations/project-evaluations.module";
import { loadRuleSet } from "../modules/rules/rules.repository";
import { resolveActiveKnowledgeBaseCatalog, type ResolvedActiveKnowledgeBaseCatalog } from "../modules/system/system.repository";
import { queryZhipuKnowledgeBase } from "../services/ai/knowledge-tool.service";
import { buildDerivedWbsItemsForUser } from "../routes/wbs.routes";

/**
 * 默认 Agent 工具注册表（O2 · A3）：注册全部 11 个工具（批次 9 起 = 原 8 个
 * + ask_user + 内置发现工具 list_tools；批次 4 再起 + describe_capabilities）。
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
  const businessRole = resolveBusinessRole(user);

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
  registry.register(buildKnowledgeQueryTool((query) => runKnowledgeQuery(query, businessRole, runtime)));
  registry.register(buildRuleLookupTool(() => loadRuleSet()));

  // ---- 写操作类（A2，全部 mutates=true → need_confirm） ----
  registry.register(
    buildCreateProjectTool((input) => createProjectEvaluationForUser(user, { ...input })),
  );
  registry.register(
    // 阶段 1 批 4：buildDerivedWbsItemsForUser 级联改 async，回调 await 后返回（工具类型已兼容 Promise）
    buildGenerateWbsTool(async () => ({
      items: await buildDerivedWbsItemsForUser({ id: user.id, username: user.username }),
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

  // ---- 批次 9：向用户发起交互（mutates=false → allow 档，不经审批） ----
  // 注册在写操作之后、发现工具之前：既有 8 个工具的注入顺序因此逐字节不变，
  // list_tools 仍在末位（按需发现模式按 category=discovery 排除它）。
  registry.register(buildAskUserTool());

  // ---- 批次 4：能力清单（capability_discovery 正则退役后的承接方） ----
  // 排在 ask_user 之后、发现工具之前：原 8 个工具的注入顺序仍逐字节不变。
  registry.register(buildDescribeCapabilitiesTool());

  // ---- SP-2026-007 MS3：内置发现工具（注册在最后，全量回退时按 category=discovery 排除，
  //      保证旧 8 工具注入顺序逐字节一致；按需发现模式下常驻核心注入集） ----
  registry.register(buildListToolsTool(registry));

  return registry;
}

/** 知识库查询的可注入接缝：默认走真实目录与智谱客户端，测试据此断言选库口径 */
export type KnowledgeQueryDeps = {
  loadCatalog?: () => Promise<ResolvedActiveKnowledgeBaseCatalog>;
  invoke?: (query: string, config: ZhipuKnowledgeToolConfig) => Promise<ZhipuKnowledgeToolTrace>;
};

/**
 * 知识库查询接线（批次 4 起 = `knowledge_query` 工具的实现）。
 *
 * 退役前这套口径写在 knowledge-query.handler 里，由正则决定要不要用它；批次 4 把
 * 「这句话该不该查知识库」交回模型之后，本函数成为**唯一**入口，因此把 handler 原本
 * 承担的三条硬约束原样搬过来，一条都不放松：
 *  1. 授权：`routeKnowledgeBase` 先按调用者业务角色过滤可见库（`allowedBusinessRoles`），
 *     模型无从指定、也无从越权——原实现直接取 `catalog.profiles[0]`，既不看角色可见性
 *     也不看优先级，退役后会成为唯一路径，故一并收口。
 *  2. 选定：命中库名/关键词优先，其次唯一可见库，再次安全默认库。
 *  3. 回退：**只有** `retrieval_empty` 才重试一次授权内的候选库；
 *     其它失败（`retrieval_failed` / `missing_config`…）就地返回，不向多个库扩散。
 * 无可见库时以空凭据下传，由底层返回「不可用」说明——失败方向关闭，与退役前同款。
 */
export async function runKnowledgeQuery(
  query: string,
  businessRole: BusinessRole,
  runtime?: RuntimeContext,
  deps: KnowledgeQueryDeps = {},
): Promise<ZhipuKnowledgeToolTrace> {
  const catalog = await (deps.loadCatalog ?? resolveActiveKnowledgeBaseCatalog)();
  const invoke = deps.invoke ?? queryZhipuKnowledgeBase;
  const route = await routeKnowledgeBase({ query, businessRole, profiles: catalog.profiles });
  const call = (knowledgeId: string) => invoke(query, {
    apiKey: knowledgeId ? catalog.apiKey : "",
    knowledgeId,
    model: catalog.model,
    apiBaseUrl: catalog.apiBaseUrl,
    retrievalParams: catalog.retrievalParams,
    promptProfile: catalog.promptProfile,
    configVersion: catalog.configVersion,
    ...(runtime?.requestId ? { requestId: runtime.requestId } : {}),
  });
  if (!route.primaryProfile) return call("");
  const trace = await call(route.primaryProfile.knowledgeId);
  if (trace.fallbackReason === "retrieval_empty" && route.fallbackProfile) {
    return call(route.fallbackProfile.knowledgeId);
  }
  return trace;
}
