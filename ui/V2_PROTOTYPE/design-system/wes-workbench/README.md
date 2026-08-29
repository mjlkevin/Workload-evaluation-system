# wes-workbench — WES 工作台设计系统包

从 `ui/V2_PROTOTYPE` 提炼的 Open-Design 可链接设计系统包，契约版本 `od-design-system-project/v1`。

## 阅读顺序

1. `DESIGN.md` — 设计方向、视觉语言与口径
2. `tokens.css` — 84 个语义 token（56 共享 schema + 28 WES 扩展），`:root` 块可直接整块粘贴
3. `USAGE.md` — 使用规则、Do/Avoid
4. `components.html` — 组件 fixture（与 tokens.css 首个 `:root` 字节同步）

## 派生文件（勿手改）

- `tailwind-v4.css`、`components.manifest.json` 由官方派生函数生成，守卫做字节/深等比对；改 `tokens.css` 或 `components.html` 后必须重新生成。

## 链接进 Open-Design

```bash
./link-to-open-design.sh
```

脚本会：复制本包到 `.codex-tools/open-design/design-systems/wes-workbench/`，检查 `BRAND_EXTENSIONS["wes-workbench"]` 白名单注册状态，并尝试运行官方守卫。

白名单注册位置（一次性人工操作）：
`.codex-tools/open-design/packages/contracts/src/design-systems/token-schema.ts`
→ `BRAND_EXTENSIONS` 下新增 `"wes-workbench"` 条目（28 个扩展 token，已于 2026-08-28 注册完成）。

## 守卫（2026-08-28 结果）

| 守卫 | 结果 |
|---|---|
| check-tokens-fixture-sync.ts | ✅ 152 brand pairs aligned / 8566 declarations |
| check-design-system-manifests.ts | ✅ 152 project manifests valid |
| check-design-system-package-quality.ts | ✅ 151 migrated packages, average score 100 |
| check-design-system-flag-parity.ts | ⚠️ 本地克隆缺 node_modules 无法运行，装依赖后补跑 |

## 来源证据

- `source/evidence.md` — 提炼方法与重命名映射表
- `source/tokens.source.json` — 每条 token 的来源绑定与排除项
