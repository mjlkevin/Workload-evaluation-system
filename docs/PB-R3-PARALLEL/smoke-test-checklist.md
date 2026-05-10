# PB-R3 · 18 路由 Smoke Test Checklist

用途：KIMI CODE PB-R3 全部完工后，Kevin 在浏览器手工验收。默认 DevServer：`http://localhost:3003`。

## 全局检查（一次过）

- [ ] DevServer 跑在 `http://localhost:3003`
- [ ] 首屏无白屏、无 Vite overlay
- [ ] 侧栏 10 个导航图标全显示：`● ✎ ▣ ◆ $ ☷ ✓ ⚙ ☺ ⚿`
- [ ] 侧栏当前路由高亮正确
- [ ] PageShell 页头统一：面包屑 + H1 + 副标题 + 右上 actions
- [ ] 所有 list 页行选择标准一致：单击单选、Cmd/Ctrl 单击 toggle、Shift 单击区间
- [ ] React Router future warnings 为 0
- [ ] DevTools console：0 error / 0 warning
- [ ] Network：无页面级 404 / 500
- [ ] `/api-keys` 返回页面而非被 `/api/` proxy 吞掉
- [ ] 禁用 token grep：`var(--purple-`、`var(--soft)`、`var(--card)`、`var(--muted)`、`var(--gold)`、`var(--blue)`、`var(--warn-bg)`、`var(--err-bg)`、`var(--shadow-lg)`、`var(--shadow-xl)` 均 0
- [ ] 1280px：内容不横向溢出
- [ ] 1440px：主设计宽度不破图
- [ ] 1920px：宽屏布局不松散/不漂移
- [ ] 1180px 折叠：侧栏到顶、主内容可读
- [ ] 760px 折叠：grid 单列、按钮不压字

## 1. `/login` · Login.jsx

**URL**：`http://localhost:3003/login`

### 视觉检查
- [ ] 居中品牌卡可见，背景为品牌渐变
- [ ] 标题/副标题与 WES 品牌露出完整
- [ ] 登录态显示用户名、密码、记住 7 天、忘记密码
- [ ] 页脚版本号与语言入口可见

### 交互检查
- [ ] 点击“使用邀请码激活”切到注册态
- [ ] 注册态显示邮箱、用户名、密码、邀请码
- [ ] 点击“返回登录”切回登录态
- [ ] 输入框 `autoComplete` 不报浏览器警告

### 横向检查
- [ ] 760px 下卡片不超屏
- [ ] console 0 warning/error

### 已知偏差
- [ ] 待 PB-R3 最终确认：注册态 password 是否使用 `new-password`

## 2. `/` · HomePage.jsx

**URL**：`http://localhost:3003/`

### 视觉检查
- [ ] 4 KPI 卡片完整显示
- [ ] 评估方案列表在主区域
- [ ] 右栏快速操作和最近动态可见
- [ ] VCS 9 toolbar 可见：历史/检出/检入/撤销/升版/解锁/删除/ER/新建
- [ ] 已检入/已检出状态 chip 清晰

### 交互检查
- [ ] 单击一行只选中当前行
- [ ] Cmd/Ctrl 单击可多选
- [ ] Shift 单击可区间选择
- [ ] 已选 0 时需要选择的 VCS 按钮禁用
- [ ] 选择已检入行后“检出”可用，“检入/撤销/解锁”禁用
- [ ] 选择已检出行后“检入/撤销/解锁”可用
- [ ] 点击“新建”打开 D1 新建方案向导
- [ ] D1 确认后进入 D2 创建后引导
- [ ] 点击 ER 打开 D3 ER 关联图
- [ ] 双击列表行可打开 ER 或指定详情行为

### 横向检查
- [ ] 1180px `.home-grid` 单列
- [ ] 760px KPI 单列
- [ ] console 0 warning/error

### 已知偏差
- [ ] 待 PB-R3 最终确认：快速操作中非 mock action 是否应接真实跳转

## 3. `/assessments` · AssessmentList.jsx

**URL**：`http://localhost:3003/assessments`

### 视觉检查
- [ ] 页面标题为实施评估列表
- [ ] 列表列包含项目名、产品线、总方案、最新版本、报价模式、总人天、组织数、状态、人员、更新时间
- [ ] toolbar 左侧始终显示已选 N 和预览/修改/历史/删除
- [ ] filter chips 与搜索框在右侧

### 交互检查
- [ ] 单击/Cmd/Shift 行选择符合全局标准
- [ ] filter chip 点击后真过滤
- [ ] 搜索项目名/版本号可过滤
- [ ] 双击行进入 `/assessments/:id`
- [ ] 未选择时单选动作禁用，选 1 行后启用

### 横向检查
- [ ] 1280/1440/1920 不横向破图
- [ ] console 0 warning/error

### 已知偏差
- [ ] 待确认是否展示 `difficultyFactor` 列

## 4. `/assessments/:id` · AssessmentDetail.jsx

**URL**：`http://localhost:3003/assessments/ASM-018`

### 视觉检查
- [ ] 页头有面包屑“工作台 / 实施评估 / 详情”
- [ ] PageShell 包裹，侧栏 + 内容区无错位
- [ ] 项目身份卡可见：项目名 + 产品线 + 需求来源 + 版本号 + 检出状态
- [ ] 只读态使用 emerald 背景与左边框；编辑态状态清楚
- [ ] 评估参数 mini bar 4 项：用户数 / 难度 / 组织 / 相似度
- [ ] 难度 ≥ 1.3 时有朱砂橙警示
- [ ] 模板/规则集折叠在“高级”
- [ ] VCS condensed toolbar 为主操作 + 状态条 + 更多
- [ ] KPI 4 卡形态正确
- [ ] 三层选择器：报价模式 → 预置 → 云产品
- [ ] SKU 表标准人天三档色
- [ ] 自定义人天 stepper 带 +N/-N 差量胶囊
- [ ] 未勾选 SKU 行弱化
- [ ] DSL 顶部红 banner 聚合违规
- [ ] AI Copilot 为紫族 `oklch(.62 .20 320)` 渐变

### 交互检查
- [ ] 6 个 Tab 可切换：明细 / 多组织推广 / 变更对比 / DSL 规则审阅 / 五段叙事 / 附件 SOW
- [ ] SKU 勾选联动 KPI 和小计
- [ ] stepper +/- 可改自定义人天
- [ ] 一键修复 DSL 后 banner 状态变化，签入禁用解除
- [ ] 更多菜单可打开完整 VCS 操作

### 横向检查
- [ ] 1180px 主区和右栏不重叠
- [ ] 760px SKU 表可横向滚动但页面不溢出
- [ ] console 0 warning/error

### 已知偏差
- [ ] 待 PB-R3 完成后填

## 5. `/requirements` · RequirementList.jsx

**URL**：`http://localhost:3003/requirements`

### 视觉检查
- [ ] 标题/副标题正确
- [ ] ListPage toolbar 与其他 list 页一致
- [ ] 列包含需求版本、项目、客户、状态、创建/更新人、更新时间
- [ ] 状态 chip 色彩清楚

### 交互检查
- [ ] 单击/Cmd/Shift 行选择符合标准
- [ ] filter chips 真过滤
- [ ] 搜索可过滤需求编号或项目名
- [ ] 双击行进入 `/requirements/:id`

### 横向检查
- [ ] 1280/1440/1920 不破图
- [ ] console 0 warning/error

### 已知偏差
- [ ] 待 PB-R3 完成后填

## 6. `/requirements/:id` · RequirementDetail.jsx

**URL**：`http://localhost:3003/requirements/RQ-GLOBAL-20260404-0053`

### 视觉检查
- [ ] 顶部 Kimi-help 为紫族下拉
- [ ] 下拉菜单包含解析/评估/生成或设计稿指定动作
- [ ] 6+1 区动态行表完整：上下文、基本情况、价值主张、业务范围、开发概览、产品模块、多组织/评估总览
- [ ] 右侧完整度 donut、AI Copilot、时间线/摘要可见
- [ ] DSL 冲突行/摘要不产生行级红字噪声

### 交互检查
- [ ] Kimi-help 下拉可打开/关闭
- [ ] 4 个 dialog 均可打开和关闭
- [ ] 动态行表可编辑或展示设计稿要求的状态
- [ ] VCS 操作与只读/检出态一致
- [ ] Tab 切换不丢失当前内容

### 横向检查
- [ ] 1180px 右栏下沉或不重叠
- [ ] 760px 动态行表可读
- [ ] console 0 warning/error

### 已知偏差
- [ ] PB-R2 延期项：Kimi-help、4 dialog、6+1 区需 PB-R3 闭环

## 7. `/dev-assessments` · DevAssessmentList.jsx

**URL**：`http://localhost:3003/dev-assessments`

### 视觉检查
- [ ] ListPage toolbar 一致
- [ ] 列包含项目、总方案、开发评估版本、评估人、总人天、状态、更新时间
- [ ] 状态 chip 清楚

### 交互检查
- [ ] 单击/Cmd/Shift 行选择符合标准
- [ ] filter chips 真过滤
- [ ] 搜索可过滤
- [ ] 双击进入 `/dev-assessments/:id`

### 横向检查
- [ ] 1280/1440/1920 不破图
- [ ] console 0 warning/error

### 已知偏差
- [ ] 待 PB-R3 完成后填

## 8. `/dev-assessments/:id` · DevAssessmentDetail.jsx

**URL**：`http://localhost:3003/dev-assessments/1`

### 视觉检查
- [ ] AI 生成按钮是紫族下拉
- [ ] 角色/RBAC 状态有清晰视觉提示
- [ ] stepper 可见，`.df` 难度 bar 可见
- [ ] “合并到实施评估”按钮可见
- [ ] 开发子项表按组分隔

### 交互检查
- [ ] AI 下拉可打开/关闭并触发 mock/提示
- [ ] stepper +/- 可改基础人天
- [ ] 切换角色后保存/合并/AI 的 enabled 状态变化
- [ ] 无权限按钮不可点且有 tooltip/title
- [ ] 合并操作有确认或反馈

### 横向检查
- [ ] 760px 表格可滚动
- [ ] console 0 warning/error

### 已知偏差
- [ ] PB-R2 延期项：AI 紫族下拉 + RBAC gate 需 PB-R3 闭环

## 9. `/resource-costs` · ResourceCostList.jsx

**URL**：`http://localhost:3003/resource-costs`

### 视觉检查
- [ ] ListPage toolbar 一致
- [ ] 列包含项目、总方案、资源版本、报价模式、总人天、组织数、状态、人员、更新时间
- [ ] 如为空态，展示资源成本专属空态与 CTA

### 交互检查
- [ ] 单击/Cmd/Shift 行选择符合标准
- [ ] filter chips 真过滤
- [ ] 搜索可过滤
- [ ] 双击进入 `/resource-costs/:id`

### 横向检查
- [ ] 1280/1440/1920 不破图
- [ ] console 0 warning/error

### 已知偏差
- [ ] 待确认是否展示 `difficultyFactor`

## 10. `/resource-costs/:id` · ResourceCostDetail.jsx

**URL**：`http://localhost:3003/resource-costs/1`

### 视觉检查
- [ ] 全套 VCS 可见：历史/升版/检入/撤销/检出/解锁/导出/保存
- [ ] 当前已检出态：检入主按钮，检出 disabled
- [ ] KPI 三联：柱图、进度环、donut
- [ ] 月份铺开表可见，合计行清楚
- [ ] 右侧对照、AI、RateCard 可见
- [ ] Tabs 使用 `.tabs .t` 样式

### 交互检查
- [ ] VCS 按钮点击有反馈或确认
- [ ] 增加/减少投入月按钮有反馈
- [ ] 不含差旅切换有反馈
- [ ] 新增行按钮有反馈
- [ ] Tab 可切换或明确占位

### 横向检查
- [ ] 760px 月份表横向滚动
- [ ] console 0 warning/error

### 已知偏差
- [ ] 待 PB-R3 完成后填

## 11. `/reviews` · ReviewList.jsx

**URL**：`http://localhost:3003/reviews`

### 视觉检查
- [ ] ListPage toolbar 一致
- [ ] 列包含项目、版本、评审人、截止日期、状态、更新时间
- [ ] 驳回/通过/待评审状态区分清楚

### 交互检查
- [ ] 单击/Cmd/Shift 行选择符合标准
- [ ] filter chips 真过滤
- [ ] 搜索可过滤
- [ ] 双击进入 `/reviews/:id`

### 横向检查
- [ ] 1280/1440/1920 不破图
- [ ] console 0 warning/error

### 已知偏差
- [ ] 待 PB-R3 完成后填

## 12. `/reviews/:id` · ReviewDetail.jsx

**URL**：`http://localhost:3003/reviews/REV-001`

### 视觉检查
- [ ] Checklist 可见，完成度 donut 与 checklist 数量一致
- [ ] 评论区可见
- [ ] 关联文档为真实 Link
- [ ] PM 交付物表包含 PDF/DOCX/MD/XLSX
- [ ] PM 接力卡可见

### 交互检查
- [ ] 点击“驳回”打开必填原因 dialog
- [ ] 空原因不能确认驳回
- [ ] 输入原因后确认有反馈并关闭
- [ ] 单个生成可将 pending → generated
- [ ] 一键全部生成可批量 pending → generated
- [ ] generated 后出现下载/盖章
- [ ] 盖章 dialog 可选择印章
- [ ] 确认盖章后 generated → sealed
- [ ] 关联文档 Link 跳转正确

### 横向检查
- [ ] 760px 右栏不压主表
- [ ] console 0 warning/error

### 已知偏差
- [ ] 待 PB-R3 完成后填

## 13. `/wbs` · WbsList.jsx

**URL**：`http://localhost:3003/wbs`

### 视觉检查
- [ ] ListPage toolbar 一致
- [ ] 迷你甘特列为 120px 进度条
- [ ] 已完成/进行中两段色正确
- [ ] 起止日期、负责人、状态可见

### 交互检查
- [ ] 单击/Cmd/Shift 行选择符合标准
- [ ] filter chips 真过滤
- [ ] 双击行不进入不存在路由，若详情未建应明确提示

### 横向检查
- [ ] 1280/1440/1920 不破图
- [ ] console 0 warning/error

### 已知偏差
- [ ] WBS 详情页若 PB-R3 未建，应保持非 broken route

## 14. `/history` · HistoryList.jsx

**URL**：`http://localhost:3003/history`

### 视觉检查
- [ ] 8 条历史项目可见
- [ ] 每行显示客户/行业/规模/金额/年份
- [ ] 相似度进度条按区间染色
- [ ] ListPage toolbar 一致

### 交互检查
- [ ] 单击/Cmd/Shift 行选择符合标准
- [ ] filter chips 真过滤
- [ ] 双击进入 `/history/:id`
- [ ] 搜索可过滤项目或客户

### 横向检查
- [ ] 1280/1440/1920 不破图
- [ ] console 0 warning/error

### 已知偏差
- [ ] 待 PB-R3 完成后填

## 15. `/history/:id` · HistoryDetail.jsx

**URL**：`http://localhost:3003/history/1`

### 视觉检查
- [ ] 相似度评分卡可见
- [ ] 克隆此方案按钮可见
- [ ] 基本信息、时间线、SKU 树、差异对比区块可见
- [ ] 关联团队成员可见

### 交互检查
- [ ] 点击克隆按钮有反馈或打开新建流程
- [ ] 从 HistoryList 双击进入后内容正确
- [ ] 差异对比区若占位，应明确 PB-R3 状态

### 横向检查
- [ ] 760px 双栏不重叠
- [ ] console 0 warning/error

### 已知偏差
- [ ] 待 PB-R3 完成后填

## 16. `/system` · SystemManagement.jsx

**URL**：`http://localhost:3003/system`

### 视觉检查
- [ ] Tabs：编码规则、模型配置、RateCard、DSL 规则集、模板
- [ ] 编码规则表可见
- [ ] 模型配置显示 KIMI 评估、文件解析、生成模型三模型
- [ ] DSL 规则集不是纯 JSON 占位，至少可读可切换
- [ ] 模板页显示模板卡/表

### 交互检查
- [ ] Tabs 可切换
- [ ] 点击提示词打开 dialog
- [ ] dialog 内三类 prompt 可切换/编辑
- [ ] 模型测试连接按钮有反馈
- [ ] DSL rule enabled 可切换
- [ ] 模板操作有反馈或明确占位

### 横向检查
- [ ] 760px 表格/卡片不溢出
- [ ] console 0 warning/error

### 已知偏差
- [ ] PB-R2 延期项：提示词 dialog、三模型、DSL/模板需 PB-R3 闭环

## 17. `/users` · UserManagement.jsx

**URL**：`http://localhost:3003/users`

### 视觉检查
- [ ] 单行 toolbar 显示已选 N、批量启用/禁用/改角色、邀请成员、搜索
- [ ] 系统账号锁定视觉清楚
- [ ] 角色 chip 与状态 chip 清楚

### 交互检查
- [ ] 单击/Cmd/Shift 行选择符合标准
- [ ] 锁定账号不可选
- [ ] 搜索用户名可过滤
- [ ] 批量启用/禁用会改状态
- [ ] 改角色打开 dialog
- [ ] 降权超级管理员触发二次确认
- [ ] 输入确认文案后才允许降权
- [ ] 邀请成员按钮有反馈或 dialog

### 横向检查
- [ ] 760px toolbar 换行但不压字
- [ ] console 0 warning/error

### 已知偏差
- [ ] PB-R2 延期项：toolbar 实交互 + 降权保护需 PB-R3 闭环

## 18. `/api-keys` · ApiKeys.jsx

**URL**：`http://localhost:3003/api-keys`

### 视觉检查
- [ ] 双栏布局：API Keys + 接入契约
- [ ] API key 状态 active/revoked 清楚
- [ ] HTTP method chip 着色正确
- [ ] 接口目录显示 AUTH / PLANS / ASSESSMENTS

### 交互检查
- [ ] 搜索 input 可过滤 key 名称或 key 文本
- [ ] 复制按钮写入剪贴板或出现 toast
- [ ] 生成新 Key 打开 dialog
- [ ] 名称为空时不能生成
- [ ] 选择 scope 后生成新 key 并出现在表格
- [ ] active key 可撤销
- [ ] revoked key 可恢复
- [ ] `/api-keys` 页面刷新仍是 200，不被 proxy 吞

### 横向检查
- [ ] 760px 双栏不重叠
- [ ] console 0 warning/error

### 已知偏差
- [ ] 待 PB-R3 完成后填

## 验收完结条件

- [ ] 全局检查 16/16 通过
- [ ] 18 个路由均可打开，无白屏
- [ ] 任一路由出现 console error、页面 500、白屏、关键主流程不可点，判定不通过
- [ ] 每页视觉/交互关键项允许最多 1 个轻微偏差，但不得影响 PB-R3 指定闭环项
- [ ] 所有 list 页必须通过行选择标准，否则判定不通过
- [ ] AssessmentDetail、RequirementDetail、DevAssessmentDetail、ReviewDetail、SystemManagement、UserManagement、ApiKeys 为重点页，PB-R3 指定项必须全绿

---
**Checklist 完成**：18 路由 · 共 197 个检查点 · 平均 ~10.9 项/页  
预估 Kevin 全部走完时间：~55 分钟
