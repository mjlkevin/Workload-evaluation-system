# maintain-wes-command-board Changelog

## v1.0.0 - 2026-06-23

- 初始发布项目级 Skill，用于约束 WES 后续需求、设计、开发、变更、监控、测试与风险工作同步沉淀到 `WES-Agent-升级总看板`。
- 新增总看板页面职责、生命周期映射、数据质量规则、评审门禁和最终响应口径。
- 新增 `references/board-module-map.md`，集中维护页面职责和生命周期到页面矩阵。

## v2.1.1 - 2026-09-02

- `references/board-readability-spec.md` 新增 **§2A.1 两套列宽机制并存与真凶定位**：登记看板表格列宽的两套互斥机制（显式 `<colgroup>` / 自动量 `measureColumnFit()`，后者对含 `colgroup` 或合并单元格的表直接跳过）、新增看板页优先用显式 `colgroup` 的架构侧裁决、以及“列挤压真凶是 `nowrap` 状态胶囊而非缺 `colgroup`”的实测结论与修顺序；同时对 §2A 第 29 行禁令与第 31 行 colgroup 许可的适用边界作了区分。
