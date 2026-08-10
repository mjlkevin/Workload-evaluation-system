// ============================================================
// O9 · AI Module Export — 标准 barrel
// ============================================================
// 从纯 re-export 升级为标准三层 facade：
// export { aiController, aiUsecase, aiRepository }
// controller 不再直接 export 业务函数。
// ============================================================

export { aiController } from "./ai.controller";
export { aiUsecase } from "./ai.usecase";
export { aiRepository } from "./ai.repository";
