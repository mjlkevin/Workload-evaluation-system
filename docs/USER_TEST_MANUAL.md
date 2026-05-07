# WES 3.0 用户测试使用说明书

**版本**：2026-05-07 / main HEAD `e07c077`
**适用范围**：apps/web 前端 + apps/api 后端联合测试
**目标读者**：第一次接触新系统的用户 / 测试人员

---

## 0 · 启动环境

### 0.1 前置依赖
- Node.js ≥ 24（推荐用 nvm/asdf 管理）
- PostgreSQL 17（本地 `postgres.app` 或 Docker）
- 端口 `3000`（API）和 `5173`（前端 Vite dev server）空闲

### 0.2 三种启动方式

| 方式 | 命令 | 适用场景 |
|---|---|---|
| **A · 本地双进程**（推荐开发） | 终端 1 `cd apps/api && npm run dev`<br/>终端 2 `cd apps/web && npm run dev` | 开发期 / 改 UI 热重载 |
| **B · Docker 一键** | `docker compose up -d --build` | 模拟生产 / 演示 |
| **C · 仅前端 + 远程 API** | `cd apps/web && VITE_API_PROXY_TARGET=https://your-api npm run dev` | 接测试环境 |

启动后浏览器访问：
- **前端**：http://localhost:5173
- **API 健康**：http://localhost:3000/health → 应返回 `{"status":"ok",...}`
- **API 监控**：http://localhost:3000/metrics（Prometheus 文本格式）

---

## 1 · 测试账户

`config/auth/users.json` 已有 3 个真实账户：

| 用户名 | 角色（旧）| 业务角色（v2 映射）| 用途 |
|---|---|---|---|
| `mjlkevin` | `admin` | **ADMIN** | 通杀全部模块 |
| `elly` | `user` | **PRE_SALES** | 售前测试 |
| `马文玲` | `user` | **PRE_SALES** | 中文用户名验证 |

> 密码请向管理员索取（已 bcrypt 存储，不明文）。  
> 如需新建：`POST /api/v1/auth/register`（仅开发环境开放）或直接编辑 users.json + 重启 API。

**v2 角色映射规则**（重要）：
- `admin` → `ADMIN`（25 个能力位全开）
- `sub_admin` → `PM`
- `user` → `PRE_SALES`

---

## 2 · 登录流程测试

### 2.1 正常登录
1. 浏览器开 `http://localhost:5173`
2. 看到登录页（蓝紫渐变 + 居中卡片，Element Plus 风格）
3. 输入 `mjlkevin` / 密码 → 点「登录」
4. **预期**：
   - 1 秒内跳转到 `/`（首页）
   - 顶栏右侧显示 `ADMIN` 徽章 + 用户名 `mjlkevin` + 「退出」按钮
   - localStorage 写入 `token` 字段（DevTools → Application → Local Storage 可见）

### 2.2 失败用例（请逐一验证）

| 用例 | 输入 | 预期 |
|---|---|---|
| 空用户名 | 用户名留空 + 密码 | ElMessage 红色提示「请填写用户名」|
| 空密码 | 用户名 + 密码留空 | ElMessage 红色提示「请填写密码」|
| 错密码 | `mjlkevin` + 错密码 | ElMessage 红色「用户名或密码错误」+ 表单留在登录页 |
| 不存在用户 | `nobody` + 任意密码 | 同上（不暴露用户是否存在）|

### 2.3 退出登录
- 顶栏点「退出」→ 跳回 `/login`
- localStorage 的 token 被清空
- 此时直接访问 `/presales` → 应被 router guard 拦截 → 跳 `/login`

---

## 3 · 首页（Home）测试

登录后看到的页面应该有以下 6 个区域：

```
顶栏:    [Workload Evaluation] ............ [ADMIN] [mjlkevin] [退出]
左栏:    [首页] [系统管理]
主区:    [👋 欢迎回来，mjlkevin]
         当前角色：admin
         请选择以下工作台进入相应模块

         [⚙️ 系统管理]   [📊 售前工作台]   [📝 PM 工作台]
         已开放          已开放            已开放

         [📁 PMO 工作台]  [💼 销售工作台]
         建设中          建设中
```

### 3.1 卡片点击行为

| 卡片 | 路由 | 状态 |
|---|---|---|
| 系统管理 | `/admin` | 已开放，可点击 |
| 售前工作台 | `/presales` | 已开放，可点击 |
| PM 工作台 | `/pm` | 已开放，可点击 |
| PMO 工作台 | `/pmo` | 建设中，灰按钮 / 不可点 |
| 销售工作台 | `/sales` | 建设中，灰按钮 / 不可点 |

### 3.2 角色徽章颜色（视设计）
- ADMIN → 蓝色边框
- PM → 绿色
- PRE_SALES → 紫色
- 其他角色按 §08 设计 token 颜色

---

## 4 · 售前工作台（`/presales`）测试

> **覆盖业务**：US-5 ~ US-8 + US-21（v2 §10 用户故事）

### 4.1 主菜单页 `/presales`
- 看到「需求包列表」表格（columns：行业 / 规模 / 状态 / 创建时间 / 操作）
- 表格如果为空 → 显示空态卡片「暂无需求包，去新建」
- 顶部「+ 新建需求包」按钮 → 跳 `/presales/new`

### 4.2 创建需求包 `/presales/new`
1. 表单字段：
   - 行业（必填，如 "制造业"）
   - 规模（必填，如 "集团型 / 500人"）
   - 模块（动态添加多行：moduleName + subModules 逗号分隔）
   - 约束（动态添加多行）
2. 点「创建」→ 调 `POST /api/v1/presales/requirement-packs`
3. 成功 → 跳到详情页 `/presales/:id`，ElMessage 绿色「创建成功」
4. 失败用例：
   - 不填行业 → 红色提示「行业必填」
   - 后端返回 401 → 跳登录页

### 4.3 需求包详情 `/presales/:id`（核心页）
- 显示 pack 全部字段（industry / scale / modules / constraints / status）
- 三个按钮 / 区域：
  - **「DSL 审阅」按钮** → 调 `POST /:id/review`
    - 5 条 DSL 规则跑（sow-completeness / industry-mandatory / module-dependency / confidence-threshold / wbs-completeness）
    - 展示 violations（按 severity 分组：error 红 / warning 黄 / info 蓝）
    - 展示 inquiries 列表
    - 展示 confidenceSummary 置信度（4 个雷达图维度或仪表盘）
  - **「字段置信度」表格** → 调 `GET /:id/confidences` → 表格显示每个字段的 method / source / confidence
  - **「下一步：生成初估」按钮** → 跳 `/presales/:id/initial-estimate`

### 4.4 初估包 `/presales/:id/initial-estimate`
- 「生成初估包」按钮 → 调 `POST /:id/initial-estimate`
- 显示：
  - effortEstimate 表格（按模块 + days）
  - riskTags 标签云
  - assumptions 列表
  - phaseProposal 分期计划
  - confidenceScores 4 维度

### 4.5 SOW `/presales/:id/sow`
- 「生成 SOW」按钮（cloudProduct 输入框，默认 "金蝶AI星空"）→ 调 `POST /:id/sow`
- 显示 SOW 列表（按模块）含 category / customizationScope

### 4.6 IDOR 越权防护测试（W5-E 重点）
1. 用 `mjlkevin`（admin）创建一个需求包，记下 ID（如 `abc-123`）
2. 退出，用 `elly`（user）登录
3. 浏览器直接访问 `/presales/abc-123`
4. **预期**：返回 404「资源不存在」（**不是 403**，避免泄漏 ID 是否存在）
5. admin 用户访问任意 user 的 pack ID → 应通过（admin 通杀）

---

## 5 · PM 工作台（`/pm`）测试

> **覆盖业务**：US-10 ~ US-13 + US-25 ~ US-31

### 5.1 PM 主页 `/pm`
- 4 张大卡片导航：接力 / 叙事 / 交付物 / 质量门审

### 5.2 接力视图 `/pm/handoff`
- 看到待我接力的初估包列表（GET /pm/handoffs）
- 每行：from（IMPL 顾问名） / 关联需求包 / 状态 / 接收时间
- 操作列：「接受」/「拒绝」按钮
- 接受后：状态变 accepted，跳到详情 / 启用下一步功能

### 5.3 五段式叙事 `/pm/narrative`
- 选择一个 AssessmentVersion → 「自动生成叙事」按钮（POST /pm/narratives）
- 5 段富文本编辑器：组织模块 / 数据治理 / 特殊场景 / 验收范围 / 周期成本
- 编辑后「保存」/「确认」

### 5.4 4 大交付物 `/pm/deliverables`
- 4 个 tab：人天表 / 资源人天成本表 / 差异分析表 / WBS
- 「派生」按钮（POST /pm/deliverables/derive）→ 从 AssessmentVersion 自动生成
- 每个交付物的「编辑」+「确认」+「重新派生」操作

### 5.5 质量门审 `/pm/review`
- 提交给 PMO 审核（POST /quality-gate-reviews）
- 显示审核状态 + 历史审核轨迹

---

## 6 · 系统管理（`/admin`）测试

仅 ADMIN 角色可见。需要测：
- 用户管理（列表 / 新增 / 改角色 / 禁用）
- 系统配置（KIMI_API_KEY 配置 / DSL 规则增删改 / RateCard / 方法论模板）
- 版本控制（如有）

> 具体表单字段视实现而定，本文档暂以"能进入 + 看到表格 + 增删改不报错"为通过标准。

---

## 7 · 跨切面测试

### 7.1 路由守卫
| 操作 | 预期 |
|---|---|
| 未登录访问 `/presales` | 跳 `/login` |
| 已登录但角色不匹配（如 user 访问 `/admin`）| 跳 `/`（首页）+ ElMessage toast |
| 访问 `/random-non-existent-path` | 进 `/404` 页 |
| 直接访问 `/login` 但已登录 | 跳 `/`（避免重复登录）|

### 7.2 API 错误处理
后端返回不同错误码时，前端的 UI 反应：

| HTTP 码 | 业务码（code）| 前端反应 |
|---|---|---|
| 401 | 40101 | 跳登录页 + ElMessage |
| 403 | 40301 | ElMessage 红色「权限不足」|
| 404 | 40401 | ElMessage 红色「资源不存在」|
| 413 | 41301 | ElMessage 红色「请求体过大」（W5-A 加的限制） |
| 500 | 50000 | ElMessage 红色「服务器内部错误」（不显示 err.message，W5-E 加固）|

### 7.3 浏览器兼容（粗测）
- Chrome/Edge ≥ 120：✅
- Safari ≥ 17：✅
- Firefox ≥ 120：✅
- 手机端 → 当前未做 responsive，预期布局错位（已知，Wave 6 优化）

### 7.4 性能粗测（不强制）
- 登录到首页加载 < 3s
- 各 page 切换 < 1s（已 lazy-load）
- 大表格（≥ 100 行）滚动流畅（待 W5-E 性能基线确认）

---

## 8 · 后端单独测试（可选）

如需直接测后端 API（不通过前端）：

```bash
# 1. 健康检查
curl http://localhost:3000/health
# 期望: {"status":"ok","uptime":N,"version":"0.1.0"}

curl http://localhost:3000/health/ready
# 期望: {"db":"ok","kimi":"ok|fail","ready":true|false}

# 2. 登录拿 token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"mjlkevin","password":"YOUR_PASSWORD"}' \
  | jq -r '.data.token')

# 3. 用 token 调 API
curl http://localhost:3000/api/v1/presales/requirement-packs \
  -H "Authorization: Bearer $TOKEN"

# 4. 查 Prometheus metrics
curl http://localhost:3000/metrics | head -30
```

---

## 9 · 测试用例清单（最小验收 30 条）

完整跑完以下 30 条算「核心通过」：

### 登录 / 退出（5）
- [ ] 1. mjlkevin 正确密码登录成功
- [ ] 2. 错密码提示错误
- [ ] 3. 空用户名/密码提示
- [ ] 4. 退出后 token 清空
- [ ] 5. 退出后访问 `/presales` 跳登录

### 首页 / 路由（4）
- [ ] 6. 5 张卡片显示正确（3 已开放 + 2 建设中）
- [ ] 7. 访问 `/random` 进 404
- [ ] 8. 访问已登录的 `/login` 跳首页
- [ ] 9. user 角色访问 `/admin` 被拦

### 售前工作台（10）
- [ ] 10. 列表页加载 / 空态显示
- [ ] 11. 新建需求包成功
- [ ] 12. 详情页所有字段渲染
- [ ] 13. DSL 审阅按钮触发 5 条规则
- [ ] 14. violations 按 severity 分组
- [ ] 15. inquiries 显示
- [ ] 16. confidenceSummary 4 维度
- [ ] 17. 字段置信度表格
- [ ] 18. 生成初估包
- [ ] 19. 生成 SOW

### PM 工作台（5）
- [ ] 20. 主页 4 张导航卡
- [ ] 21. 接力收件箱列表
- [ ] 22. 五段式叙事生成
- [ ] 23. 4 大交付物派生
- [ ] 24. 质量门审提交

### IDOR 越权（3）
- [ ] 25. user 访问别人 pack ID 返回 404
- [ ] 26. user 修改别人 pack 返回 404
- [ ] 27. admin 通杀

### 错误处理（3）
- [ ] 28. 401 跳登录
- [ ] 29. 500 不暴露 err.message
- [ ] 30. 413 请求体过大提示

---

## 10 · 已知缺陷 / 待 Wave 6 完成

| 项 | 状态 |
|---|---|
| PMO 工作台 / 销售工作台 | 建设中（占位）|
| 移动端响应式 | 未实现 |
| dark mode | 设计 token 已有，UI 未切 |
| OWASP Top 10 审计文档 | 未交付（不阻塞）|
| 性能基线 k6 数据 | 未交付（不阻塞）|
| AssessmentVersion v1 数据真实迁移 | W4-C 工具就绪，未在生产数据上跑过 |
| 实施顾问 / 开发顾问 / 销售 工作台 UI | Wave 6 后期 |

---

## 11 · 反馈渠道

测试发现 bug 请按以下格式反馈：

```
[bug] 简短标题
环境：浏览器+OS / 启动方式（Docker/dev）
重现步骤：
1. ...
2. ...
预期：...
实际：...
截图：...
```

提到 GitHub Issues 或共享日志文件 `docs/WORK_LOG_AI_COLLAB.md`。

---

**测试愉快。如果 30 条核心用例全过，恭喜你 — 可以开 Wave 6 试点客户对接了。**
