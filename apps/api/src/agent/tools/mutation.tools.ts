import type { AgentTool } from "../agent.types";
import type { RuntimeContext } from "../context/context.types";
import { asString } from "../../utils/helpers";

/**
 * Agent 写操作类工具（O2 · A2）
 * 全部标记 mutates=true：编排循环会先发 need_confirm 事件，
 * 经用户确认（requiresConfirm 语义）后才会真正执行。
 * 口径：附件/证据只能作为上下文引用入参（evidenceId / artifactId），
 * 任何工具不得因「存在文件」而自动触发；写动作只由用户意图驱动。
 */

/** 创建项目输入（createdFromSessionId 由 RuntimeContext 注入，不接受模型伪造） */
export interface CreateProjectInput {
  projectName: string;
  customerName?: string;
  industry?: string;
  createdFromSessionId?: string;
}

/** 底层创建项目草稿函数签名（对应 project-evaluations usecase） */
export type CreateProjectFn = (input: CreateProjectInput) => unknown | Promise<unknown>;
/** 底层生成 WBS 草稿函数签名（对应 wbs 派生逻辑） */
export type GenerateWbsFn = () => unknown | Promise<unknown>;
/** 底层导出报告函数签名（对应 estimates 计算并导出 usecase） */
export type ExportReportFn = (body: Record<string, unknown>) => Promise<unknown>;

/** usecase 失败结果的最小形态（estimates 模块的 FailedResult） */
interface UsecaseFailedResult {
  ok: false;
  code?: number;
  message: string;
}

/** usecase 返回 ok:false 时抛错，让编排层记录 tool_result 失败 */
function assertUsecaseOk(result: unknown): unknown {
  if (result && typeof result === "object" && (result as { ok?: unknown }).ok === false) {
    const failed = result as UsecaseFailedResult;
    throw new Error(failed.message || "底层操作失败");
  }
  return result;
}

/** 创建项目草稿工具（写操作，需用户确认） */
export function buildCreateProjectTool(createProject: CreateProjectFn): AgentTool {
  return {
    name: "create_project",
    description: "为当前用户创建项目评估草稿（写操作，执行前需用户确认）",
    parameters: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "项目名称" },
        customerName: { type: "string", description: "客户名称（可选）" },
        industry: { type: "string", description: "客户行业（可选）" },
      },
      required: ["projectName"],
    },
    capability: "estimates:create",
    mutates: true,
    category: "project",
    discoverable: true,
    async execute(args, _user, runtime?: RuntimeContext) {
      const projectName = asString(args.projectName);
      if (!projectName) throw new Error("create_project 需要 projectName 参数");
      const input: CreateProjectInput = {
        projectName,
        ...(asString(args.customerName) ? { customerName: asString(args.customerName) } : {}),
        ...(asString(args.industry) ? { industry: asString(args.industry) } : {}),
        // 会话来源只信任 RuntimeContext（可信上下文），防止模型伪造会话 ID
        ...(runtime?.aiSessionId ? { createdFromSessionId: runtime.aiSessionId } : {}),
      };
      return createProject(input);
    },
  };
}

/** 生成 WBS 草稿工具（写操作，需用户确认） */
export function buildGenerateWbsTool(generateWbs: GenerateWbsFn): AgentTool {
  return {
    name: "generate_wbs",
    description: "基于当前用户最新总方案生成 WBS 草稿任务（写操作，执行前需用户确认）",
    parameters: { type: "object", properties: {} },
    capability: "estimates:write",
    mutates: true,
    category: "wbs",
    discoverable: true,
    async execute() {
      return generateWbs();
    },
  };
}

/** 导出评估报告工具（写操作，需用户确认；产出导出文件并返回下载链接） */
export function buildExportReportTool(exportReport: ExportReportFn): AgentTool {
  return {
    name: "export_report",
    description: "对给定的评估条目执行计算并导出 Excel/PDF 报告（写操作，执行前需用户确认）",
    parameters: {
      type: "object",
      properties: {
        items: { type: "array", description: "评估条目数组（来自已确认的需求包或初估结果）" },
        exportType: { type: "string", enum: ["excel", "pdf"], description: "导出格式（默认 excel）" },
        exportProjectName: { type: "string", description: "导出文件使用的项目名（可选）" },
      },
      required: ["items"],
    },
    capability: "estimates:write",
    mutates: true,
    category: "export",
    discoverable: true,
    async execute(args) {
      if (!Array.isArray(args.items)) throw new Error("export_report 需要 items 数组参数");
      const body: Record<string, unknown> = {
        items: args.items,
        ...(asString(args.exportType) ? { exportType: asString(args.exportType) } : {}),
        ...(asString(args.exportProjectName) ? { exportProjectName: asString(args.exportProjectName) } : {}),
      };
      return assertUsecaseOk(await exportReport(body));
    },
  };
}
