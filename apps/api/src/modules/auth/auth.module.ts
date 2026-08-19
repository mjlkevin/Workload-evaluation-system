// ============================================================
// Auth Module Export
// ============================================================

export {
  register,
  login,
  requestPasswordReset,
  confirmPasswordReset,
  me,
  logout,
  listUsers,
  updateUserStatus,
  updateUserRole,
  updateUserBusinessRole,
  updateUserPassword,
  listInviteCodes,
  generateInviteCodeHandler
} from "./auth.controller";

// 阶段 2 批 1：仓储选择器（实现在 auth.repository.ts，避免 CJS 循环依赖）
export {
  getAuthRepository,
  type AuthStoreRepository,
} from "./auth.repository";
