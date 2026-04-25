// ============================================================
// 应用错误类型
// ============================================================

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: Array<{ field: string; reason: string }>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
