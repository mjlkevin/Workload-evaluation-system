import type { AgentTool } from "../agent.types";
import { asString } from "../../utils/helpers";

/**
 * Agent 查询类工具（O2 · A1）
 * 底层能力均以函数注入，便于单测与后续替换实现。
 * 口径：附件/证据只作为上下文引用入参；查询工具不产生任何写操作，
 * 也不会因「存在文件」而自动触发任何工作流。
 */

/** 底层项目列表查询函数签名（对应 project-evaluations usecase） */
export type ProjectListFn = (query: { keyword?: string }) => unknown | Promise<unknown>;
/** 底层评估/导出历史查询函数签名（对应 estimates usecase） */
export type EstimateHistoryFn = (query: { page: number; pageSize: number }) => unknown | Promise<unknown>;
/** 底层知识库查询函数签名（对应智谱知识库两阶段查询） */
export type KnowledgeQueryFn = (query: string) => unknown | Promise<unknown>;
/** 底层规则集查询函数签名（对应 rules repository） */
export type RuleLookupFn = () => unknown | Promise<unknown>;

/** 项目列表查询工具（读操作，按 owner 隔离由注入函数保证） */
export function buildProjectListTool(listProjects: ProjectListFn): AgentTool {
  return {
    name: "project_list",
    description: "查询当前用户名下的项目评估列表，支持按项目名/客户/行业关键词过滤",
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "模糊搜索关键词（可选）" },
      },
    },
    capability: "estimates:read",
    mutates: false,
    category: "project",
    discoverable: false,
    async execute(args) {
      const keyword = asString(args.keyword);
      return listProjects({ ...(keyword ? { keyword } : {}) });
    },
  };
}

/** 评估历史查询工具（读操作，按 owner 隔离由注入函数保证） */
export function buildEstimateHistoryTool(listHistory: EstimateHistoryFn): AgentTool {
  return {
    name: "estimate_history",
    description: "查询当前用户的评估导出历史（文件名、大小、时间、下载链接），支持分页",
    parameters: {
      type: "object",
      properties: {
        page: { type: "number", description: "页码，从 1 开始（默认 1）" },
        pageSize: { type: "number", description: "每页条数（默认 10）" },
      },
    },
    capability: "estimates:read",
    mutates: false,
    category: "estimate",
    discoverable: true,
    async execute(args) {
      const page = Number(args.page) > 0 ? Math.trunc(Number(args.page)) : 1;
      const pageSize = Number(args.pageSize) > 0 ? Math.min(Math.trunc(Number(args.pageSize)), 50) : 10;
      return listHistory({ page, pageSize });
    },
  };
}

/** 知识库查询工具（读操作；知识库未配置时由底层返回降级说明） */
export function buildKnowledgeQueryTool(queryKnowledge: KnowledgeQueryFn): AgentTool {
  return {
    name: "knowledge_query",
    description: "检索产品/实施知识库并基于真实文档回答用户问题",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "要检索的问题或关键词" },
      },
      required: ["query"],
    },
    capability: "estimates:read",
    mutates: false,
    category: "knowledge",
    discoverable: true,
    async execute(args) {
      const query = asString(args.query);
      if (!query) throw new Error("knowledge_query 需要 query 参数");
      return queryKnowledge(query);
    },
  };
}

/** 规则集查询工具（读操作，返回当前生效的评估规则集） */
export function buildRuleLookupTool(loadRules: RuleLookupFn): AgentTool {
  return {
    name: "rule_lookup",
    description: "查询当前生效的工作量评估规则集（基础规则、组织增量规则、计算管线）",
    parameters: { type: "object", properties: {} },
    capability: "estimates:read",
    mutates: false,
    category: "rule",
    discoverable: true,
    async execute() {
      return loadRules();
    },
  };
}
