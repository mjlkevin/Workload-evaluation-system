# V0_SAAS 前端待办清单

> **背景**：apps/web（Wave 4 Vue 3 + Element Plus 工作台）已于 2026-05-07 删除（视觉风格不满意）。
> 项目前端**回归 ui/V0_SAAS**（Next.js + Radix UI）作为唯一前端。
> Wave 1-5 后端能力（22 个 routes / 17+ 张 PG 表 / 237 测试 / Docker / CI / 监控 / 安全加固）**全部保留**。
>
> 本文档列出 Wave 1-5 已完成后端但**前端无入口**的业务，供后续基于 V0_SAAS 重新构建 UI 时参考。

---

## 0 · 现状盘点

### 0.1 V0_SAAS 已有页面（2026-05-07）

| 页面 | 路径 | 状态 |
|---|---|---|
| 登录 | `/login` | ✅ 完整 |
| 仪表盘 | `/dashboard` | ✅ 完整 |
| 工作量评估（核心 v1） | `/assessment` | ✅ 完整 |
| 开发评估 | `/dev-assessment` | ✅ 完整 |
| 需求导入 | `/requirement-import` | ✅ 完整 |
| API 密钥管理 | `/api-keys` | ✅ 完整 |
| 资源成本 | `/resource-cost` | 🟡 检查完整度 |
| 审核 | `/review` | 🟡 检查覆盖范围 |
| 团队协同 | `/team-collaboration` | 🟡 检查 |
| 用户管理 | `/user-management` | 🟡 检查 |
| WBS | `/wbs` | 🟡 检查 |

### 0.2 后端能力 vs 前端入口对照

| 后端域 | 后端路由前缀 | V0_SAAS 是否有入口 |
|---|---|---|
| 认证 | `/auth` | ✅ login |
| 评估（v1）| `/estimates`, `/templates`, `/versions`, `/rules` | ✅ assessment |
| AI 抽取 | `/ai` | ✅ requirement-import |
| 团队 | `/team` | ✅ team-collaboration |
| WBS | `/wbs` | ✅ wbs |
| 系统 | `/system` | ✅ api-keys |
| 导出 | `/exports` | ✅ assessment 内 |
| 会话 | `/sessions` | ✅ assessment 内 |
| **🆕 售前审查（P1-1）** | `/presales` | ❌ **缺** |
| **🆕 PM 工作台（P1-3）** | `/pm` | ❌ **缺** |
| **🆕 PMO 审核（P1-3）** | `/pmo` | 🟡 review 可能部分覆盖 |
| **🆕 销售简报（P1-2）** | `/sales` | ❌ **缺** |
| **🆕 评估协同（P2-1）** | `/collab` | 🟡 team-collaboration 可能部分覆盖 |
| **🆕 开发评估 v2（P2-2）** | `/dev-assessment-v2`* | 🟡 dev-assessment 可能需升级 |
| **🆕 变更提报（P2-3）** | `/change` | ❌ **缺** |
| **🆕 历史项目库（P2-4）** | `/history` | ❌ **缺** |

*实际后端路由名见 `apps/api/src/routes/*.routes.ts`

---

## 1 · 缺失前端业务清单（按优先级）

### 🔴 P0 · 售前审查 Agent（最阻塞业务流）

**业务价值**：v2 §10 用户故事 US-5 ~ US-8 + US-21；售前顾问把原始物料丢进系统，AI 自动抽取需求 + DSL 5 条规则审阅 + 生成初估包 + SOW。

**需要的页面**：
- `/presales` 需求包列表
- `/presales/new` 创建需求包
- `/presales/[id]` 详情 + DSL 审阅 + 字段置信度
- `/presales/[id]/initial-estimate` 初估包
- `/presales/[id]/sow` SOW 列表

**后端 API**（已就绪）：
```
POST/GET   /api/v1/presales/requirement-packs
GET/PATCH/DELETE /api/v1/presales/requirement-packs/:id
POST       /api/v1/presales/requirement-packs/:id/review
GET        /api/v1/presales/requirement-packs/:id/confidences
POST/GET   /api/v1/presales/requirement-packs/:id/initial-estimate
POST/GET   /api/v1/presales/requirement-packs/:id/sow
```

**估算**：5-7 天

---

### 🔴 P0 · PM / PMO 工作台

**业务价值**：US-10 ~ US-13 + US-25 ~ US-31；PM 接力初估、生成 4 大交付物、五段式叙事；PMO 审核驳回。

**需要的页面**：
- `/pm/handoff` 接力收件箱
- `/pm/handoff/[id]` 接力上下文 + 4 大交付物 tab
- `/pm/narrative/[versionId]` 五段式叙事（自动生成 + 编辑）
- `/pm/deliverables` 交付物管理
- `/pmo/reviews` 待审清单
- `/pmo/reviews/[id]` 审核详情 + checklist
- `/pmo/sealed` 封版基线列表

**后端 API**（已就绪）：
```
/api/v1/pm/handoffs
/api/v1/pm/narratives
/api/v1/pm/deliverables
/api/v1/pmo/reviews
/api/v1/pmo/sealed-baselines
```

**估算**：10-14 天

---

### 🟡 P1 · 销售工作台

**业务价值**：US-1 ~ US-3（30 秒区间报价 + 分期 + 变更重算）+ US-19（老客户继承）+ US-20（一键发起合同）。

**需要的页面**：
- `/sales/briefs` 商机列表
- `/sales/briefs/new` 创建商机
- `/sales/briefs/[id]` 详情 + 生成报价 + 重算
- `/sales/briefs/[id]/changes` 变更历史

**后端 API**（已就绪）：
```
POST/GET   /api/v1/sales/briefs
GET/PATCH/DELETE /api/v1/sales/briefs/:id
POST       /api/v1/sales/briefs/:id/quote
POST       /api/v1/sales/briefs/:id/recalculate
```

**估算**：3-5 天

**v2 设计提示**：销售本来不爱开 Web，理想形态是 Claude Skill / Agent。Web 可以先做 MVP 兜底。

---

### 🟡 P1 · 历史项目库 + 相似度检索

**业务价值**：US-19 老客户二期从一期记录继承。

**需要的页面**：
- `/history/projects` 历史项目列表
- `/history/projects/[id]` 详情
- `/history/similar` 相似度查询面板（输入行业 × 规模 → 返回 top 5）

**后端 API**（已就绪）：
```
POST/GET   /api/v1/history/projects
GET        /api/v1/history/projects/:id
POST       /api/v1/history/projects/:id/close-from-baseline
GET        /api/v1/history/similar?industry=X&scale=Y&modules=A,B
```

**估算**：2-3 天

---

### 🟢 P2 · 变更提报 + 差分影响

**业务价值**：销售侧口述变更 → 系统差分重算（与 P2-3 后端配套）。

**需要的页面**：
- `/change/submissions` 列表
- `/change/submissions/[id]` 详情 + diff 视图
- 嵌入 PM 工作台显示「变更通知」

**后端 API**（已就绪）：
```
POST/GET   /api/v1/change/change-submissions
POST       /api/v1/change/change-submissions/:id/merge
POST       /api/v1/change/change-submissions/:id/reject
```

**估算**：3-4 天

---

### 🟢 P2 · 评估协同工作区（CollabWorkspace）

**业务价值**：D-8 设计决策落地，把群聊讨论沉淀到系统。

**V0_SAAS 现有 `/team-collaboration` 可能已部分覆盖**，需先盘点：
- 看 `ui/V0_SAAS/app/team-collaboration/page.tsx` 调的是什么 API
- 若调的是 `/team` 路由 → 是 v1 团队管理，不是 P2-1 的 Collab
- 若已 wrap `/collab/*` → 检查覆盖度

**后端 API**（P2-1 新增）：
```
/api/v1/collab/workspaces
/api/v1/collab/workspaces/:id/messages
（共 15 端点，含成员管理 + 质询-回复线程）
```

**估算**：升级现有 team-collaboration → 1 周；从零做 → 2 周

---

### 🟢 P3 · 开发评估 v2 + 工时占用可视化

V0_SAAS 已有 `/dev-assessment`，需检查是否对接 `/api/v1/dev-assessment` 新版 API。  
如果是 v1 实现，需要升级。

**估算**：1 周

---

## 2 · 总工期估算

| 阶段 | 内容 | 估算 |
|---|---|---|
| 调研 | V0_SAAS 现有 5 个 🟡 页面到底覆盖什么 | 1-2 天 |
| P0 - 售前 + PM/PMO | 核心业务流 | 3-4 周 |
| P1 - 销售 + 历史 | 辅助业务 | 1-1.5 周 |
| P2 - 变更 + 协同 | 增强 | 1-2 周 |
| P3 - 开发评估升级 | 收尾 | 1 周 |
| **合计** | | **6-9 周** |

---

## 3 · V0_SAAS 工程约定（基于现有代码）

| 项 | 现状 |
|---|---|
| 框架 | Next.js 14/15 (App Router) |
| UI 库 | Radix UI + Tailwind CSS（看 components.json）|
| 端口 | 3001（默认） |
| API 客户端 | `lib/api-client.ts`（apiRequest, getStoredToken） |
| Token 存储 | `localStorage["workload-auth-token-v1"]` |
| 响应格式期望 | `{ code: 0, message, data }` |
| Service 层 | `lib/workload-service.ts` |
| 类型定义 | `lib/workload-types.ts` |
| Mock 数据 | `lib/workload-mock.ts`（可参考 mock 风格做新页面） |
| 状态管理 | 看现有 page 是否用 react-query / zustand |
| E2E | playwright（`npm run test:e2e`） |

---

## 4 · 工作开展建议

### 4.1 启动前必做（1 天）
1. `cd ui/V0_SAAS && npm install && npm run dev`，浏览器测当前 5 个 🟡 页面到底是什么
2. 后端起来 `cd apps/api && npm run dev`
3. 真人跑一次 v1 评估 → 验证 V0_SAAS + Wave 5 加固后的后端兼容性
4. 列出 5 个 🟡 页面的调研结论，更新本文档「V0_SAAS 已有页面」表格

### 4.2 P0 任务执行模式（参考 Wave 4 失败教训）

| 失败教训 | 这次怎么避免 |
|---|---|
| KIMI / Sonnet 写 Vue 页面用了 Element Plus 默认风格，user 不满意 | **不让 AI 直接写 UI**。先用 v0.dev 或 Figma 出设计稿，再让 AI 实现 |
| 多 AI 并行同 worktree 冲突 | 每个 P 独立 worktree + 不同 page 目录 |
| 设计系统抽象过早导致难看 | V0_SAAS 已有 Radix 组件，**先用现成的**，等真有共性再抽象 |
| AI 编借口 / 漏 commit | 沿用 R-04-CRITICAL / R-06 规约 |

### 4.3 推荐工具链

- **设计稿生成**：v0.dev（前端可直接 React + Tailwind + shadcn 输出）/ Figma + dev mode
- **页面 AI 助手**：Cursor / Claude Code 直接在 V0_SAAS 项目里改
- **类型生成**：apps/api 的 `docs/openapi.yaml` 已存在，可用 `openapi-typescript` 给 V0_SAAS 也生成 client 类型
- **状态管理**：沿用 V0_SAAS 现有方案（不引入新库）

---

## 5 · 风险

| 风险 | 严重度 | 缓解 |
|---|---|---|
| V0_SAAS 已有页面（5 个 🟡）实际不可用，需要重做 | 🟡 | 启动前调研日确认 |
| Wave 5 后端的 IDOR 防护（W5-E）会让 V0_SAAS 拿不到别人的数据 | 🟢 | 期望行为，不是 bug |
| Wave 5 后端的 /api/v1/health 改 /health，V0_SAAS 如果有 health poll 会挂 | 🟢 | 小修，找一处改一处 |
| V0_SAAS 老旧依赖（Next 14/15）vs Node 24 兼容 | 🟡 | npm install 失败时调 .nvmrc 到 Node 20 |
| 销售工作台 Web 形态偏离 v2 Skill 设计意图 | 🟡 | 接受 MVP，长期目标是 Claude Skill |

---

## 6 · 长期愿景（M9 之后）

- **销售/售前**：转 Claude Skill / Agent（v2 §06 设计意图）
- **PM/PMO**：保留 Web 工作台（结构化操作适合 Web）
- **开发顾问**：可能转 Skill（即时报价场景）
- **总部产品**：保留 Web（DSL 规则编辑器 + RateCard 维护）

---

**生命周期**：本文档随 V0_SAAS 前端建设进度刷新，每完成一个业务对应章节标 ✅。
