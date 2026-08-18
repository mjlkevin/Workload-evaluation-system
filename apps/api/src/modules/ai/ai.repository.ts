// ============================================================
// O9 · AI Repository — 数据访问层
// ============================================================
// 封装 AI 模块所需的数据读取操作（配置读取、密钥解析）。
// 密钥解析仅代理 system.repository，不碰凭据域（ISS-2026-08-05-001）。
// ============================================================

import {
  loadRequirementSystemConfigStore,
  resolveActiveRequirementKimiApiKey,
} from "../system/system.repository";

class AiRepository {
  /** 加载需求系统配置（非密钥部分：评估参数、超时、prompt 等）。阶段 1 批 5：因内部调用已异步化，返回 Promise，实现不动。 */
  loadRequirementSettings() {
    return loadRequirementSystemConfigStore();
  }

  /** 解析当前激活的 Kimi API Key（代理 system.repository，不持有明文） */
  resolveApiKey(): { apiKey: string } {
    return resolveActiveRequirementKimiApiKey();
  }
}

export const aiRepository = new AiRepository();
