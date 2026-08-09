# Fireworks Tech Graph

> Qoder Plugin 适配版 — 技术图表生成 Skill

## 来源

- **原始仓库**: [yizhiyanhua-ai/fireworks-tech-graph](https://github.com/yizhiyanhua-ai/fireworks-tech-graph)
- **许可证**: MIT
- **版本**: v1.2.0

## 功能

不用手画图了。用中文描述你的系统，直接得到通过几何门禁的 SVG、PNG、聚焦的 SVG 转 GIF 动效与离线交互技术图。

- **12 种视觉风格**: 扁平图标、暗黑极客、工程蓝图、Notion 极简、玻璃态卡片、Claude 官方、OpenAI 官方、暗黑奢华、C4 评审画布、Cloud Fabric、Event Transit、Ops Pulse
- **14 种图类型**: 软件架构图、数据流图、流程图、时序图、C4 评审、云部署、事件流、可观测性排查、Agent/记忆系统、UML、ER 图、网络拓扑、时间线、技术概念图
- **输出格式**: SVG、PNG、GIF 动效、离线交互 HTML

## 使用方式

在 Qoder 对话中，当需要生成技术图表时，直接描述你的系统架构或流程，Skill 会自动：

1. 识别图表类型和风格
2. 生成经过几何校验的 SVG
3. 按需导出 PNG 或 GIF 动效

示例：
```
"画一张 Mem0 的架构图，暗黑风格"
"生成一个微服务系统的部署流程时序图"
"把这张架构图导出为 GIF 动效"
```

## 包含文件

- `SKILL.md` — Skill 主入口（触发条件、工作流、脚本调用指南）
- `scripts/` — Python/Shell 脚本（SVG 生成、验证、导出、动效）
- `references/` — 12 种风格参考文档与构图质量契约
- `templates/` — SVG 模板
- `schemas/` — JSON Schema 校验
- `examples/` — 示例图
- `fixtures/` — 回归测试基线
- `assets/` — 图标资源与示例样张

## 安装验证

```bash
# 验证 SVG 生成
python3 skills/fireworks-tech-graph/scripts/fireworks.py --help

# 验证 SVG 校验
bash skills/fireworks-tech-graph/scripts/validate-svg.sh
```

## 注意事项

- 本插件为 Qoder 适配版，保留了原始仓库的完整功能
- 原始仓库同时支持 Codex 和 Claude Code，本适配版针对 Qoder 环境调整
- 首次使用前请确保系统已安装 Python 3 和 Node.js（用于 SVG 转 PNG/GIF）
