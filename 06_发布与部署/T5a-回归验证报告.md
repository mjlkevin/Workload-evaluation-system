# T5a 回归验证报告 — 版本机制 + 鉴权 + 错误码

> 执行日期：2026-05-21 (D6)
> 执行人：Ban
> 分支：main
> 协作方：Tina（T5b 四大评估 + 部署回归）

---

## 总体结果

| 验证项 | 通过数 | 失败数 | 状态 |
|--------|--------|--------|------|
| T5a-1 基础测试套件 | 49 | 0 | ✅ PASS |
| T5a-2 VCS 全链路 | 12 | 0 | ✅ PASS |
| T5a-3 JWT 鉴权 | 10 | 0 | ✅ PASS |
| T5a-4 错误码一致性 | 37 | 0 | ✅ PASS |
| **总计** | **108** | **0** | **✅ PASS** |

---

## T5a-1 基础测试套件

| 测试 | 结果 | 证据 |
|------|------|------|
| `npm run test:modules` | ✅ 40/40 pass | 含 versions.usecase 全链路 (checkout/checkin/undo/promote/force-unlock) |
| `npm run test:rules` | ✅ 8/8 pass | 引擎计算规则验证 |
| `npm run test:integration` | ✅ 1/1 pass | API 集成测试通过 |
| `npm run test:api:team` | ✅ 12 checks pass | 团队 API + 评审 + 评论 + 权限 |
| `npm run build:api` | ✅ 通过 | TypeScript 编译无错误 |

---

## T5a-2 VCS 全链路验证（12 项）

| # | 测试项 | 状态 | 说明 |
|---|--------|------|------|
| 1 | health_check | ✅ | API 健康检查正常 |
| 2 | create_version | ✅ | Admin 可创建版本，版本码自动生成 |
| 3 | checkout | ✅ | 版本检出成功，checkoutStatus=checked_out |
| 4 | checkout_double_lock_guard | ✅ | 已检出版本重复检出被拒绝 (409) |
| 5 | save_draft_edit | ✅ | 检出中可保存草稿，状态保持 checked_out |
| 6 | checkin | ✅ | 检入成功，checkoutStatus=checked_in，minorNumber 递增 |
| 7 | checkout_second_time | ✅ | 检入后可再次检出 |
| 8 | undo_checkout | ✅ | 撤销检出成功，恢复 checked_in 状态 |
| 9 | promote | ✅ | 升版成功，旧版本归档，新版本创建并自动检出 |
| 10 | force_unlock_by_admin | ✅ | Admin 可强制解锁任意用户的检出 |
| 11 | force_unlock_non_admin_forbidden | ✅ | 非 Admin 强制解锁返回 403/40301 |
| 12 | all_vcs_actions | ✅ | 全链路无异常 |

**状态机验证**：
```
CREATE → checkout → save-draft → checkin → checkout → undo → promote → force-unlock
 checked_in → checked_out → (编辑) → checked_in → checked_out → checked_in → (新) checked_out → checked_in
```

---

## T5a-3 JWT 鉴权验证（10 项）

| # | 测试项 | 状态 | 说明 |
|---|--------|------|------|
| 1 | health_check | ✅ | API 可用 |
| 2 | login_synthetic_token | ✅ | 可生成有效 JWT（使用已知 secret） |
| 3 | access_protected_endpoint | ✅ | 有效 token 可访问 /api/v1/auth/me |
| 4 | **401_no_token** | ✅ | 无 Bearer token → 401/40101 "未登录或凭证缺失" |
| 5 | **401_expired_token** | ✅ | 过期 token → 401/40102 "登录态无效" |
| 6 | **401_tampered_token** | ✅ | 篡改 token → 401/40102 "登录态无效" |
| 7 | **403_non_admin_access** | ✅ | 非 Admin 调用 /force-unlock → 403/40301 |
| 8 | **403_rbac_capability** | ✅ | PRE_SALES 角色调用 estimates:create → 403/40301（含缺失能力位详情） |
| 9 | response_format_success | ✅ | 成功响应含 code:0 + requestId |
| 10 | response_format_error | ✅ | 错误响应含 code + message + details[] + requestId |

**401/403 语义一致性**：
- 40101 = 未登录或凭证缺失（无 Bearer header）
- 40102 = 登录态无效（JWT 过期/篡改/密钥不匹配）
- 40103 = 用户不可用（用户被禁用/不存在）
- 40301 = 权限不足（role/capability 不匹配，含 RBAC 详情）

---

## T5a-4 错误码一致性（37 项）

### 标准 7 错误码覆盖

| 错误码 | 名称 | 使用次数 | 状态 |
|--------|------|----------|------|
| `0` | 成功 | 多处 | ✅ |
| `40001` | 参数错误 | 67 次 | ✅ |
| `40003` | 规则校验失败 | 1 次 | ✅ |
| `40101` | 未登录或凭证缺失 | 1 次 | ✅ |
| `40301` | 权限不足 | 31 次 | ✅ |
| `40401` | 资源不存在 | 28 次 | ✅ |
| `42201` | 计算请求数据不完整 | 11 次 | ✅ |
| `50001` | 系统内部错误 | 2 次 | ✅ |

### 扩展错误码（符合命名规范）

| 错误码 | 名称 | 范围 | 状态 |
|--------|------|------|------|
| `40102` | 登录态无效 | 401xx auth | ✅ |
| `40103` | 用户不可用 | 401xx auth | ✅ |
| `40400` | 资源不存在 | 404xx not_found | ✅ |
| `40404` | 版本不存在 | 404xx not_found | ✅ |
| `40901` | 版本号已存在 | 409xx conflict | ✅ |
| `40902` | 状态冲突 | 409xx conflict | ✅ |
| `40909` | 并发写入冲突 | 409xx conflict | ✅ |
| `41301` | 请求体过大 | 413xx client | ✅ |
| `42901` | 请求过于频繁 | 429xx client | ✅ |
| `50000` | 服务器内部错误 | 500xx server | ✅ |
| `50301` | KIMI 服务端繁忙 | 503xx server | ✅ |

**共发现 18 个唯一错误码，全部符合 5 位数字命名规范，HTTP 状态映射正确。**

---

## 响应格式验证

所有错误响应统一遵循：
```json
{
  "code": <number>,
  "message": "<string>",
  "details": [
    { "field": "<string>", "reason": "<string>" }
  ],
  "requestId": "<uuid>"
}
```

RBAC 403 响应额外包含：
```json
{
  "details": [{
    "field": "capability",
    "reason": "缺少能力位: estimates:create",
    "required": "estimates:create",
    "userLegacyRole": "user",
    "userV2Roles": ["PRE_SALES"]
  }]
}
```

---

## 风险评估

| 风险项 | 严重度 | 状态 |
|--------|--------|------|
| VCS 状态机异常 | 高 | ✅ 无风险 — 全链路通过 |
| 鉴权绕过 | 高 | ✅ 无风险 — 401/403 防护完整 |
| 错误码不一致 | 中 | ✅ 无风险 — 18 个码全部符合规范 |
| 响应格式不统一 | 中 | ✅ 无风险 — 统一 {code, message, details, requestId} |
| 并发写入冲突 | 低 | ⚠️ 已有 40909 错误码，但无自动化并发测试 |
| 历史数据迁移兼容 | 低 | ✅ migrateVersionRecord 已覆盖旧记录字段 |

---

## 结论

**T5a 回归验证通过。** 所有 108 项测试全部通过，无失败。

- VCS 全链路 6 个核心动作（checkout / checkin / undo / promote / force-unlock / save-draft）均可正常执行
- JWT 鉴权 401/403 语义一致，RBAC 能力位检查正确
- 错误码 7 个标准码全覆盖，18 个唯一码均符合命名规范

**建议**：与 Tina 协作完成 T5b（四大评估 + 部署回归）后，进入产品验收阶段。
