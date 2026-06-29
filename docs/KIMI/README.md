# Kimi 开放平台官方文档索引

> 抓取来源：https://platform.kimi.com/docs/llms.txt
> 抓取时间：2026-06-25
> 共计 48 个文档文件

---

## 一、概述与基础

| 文件 | 对应文档 | 说明 |
|------|---------|------|
| [00-欢迎使用Kimi-API文档.md](./00-欢迎使用Kimi-API文档.md) | overview.md | 文档首页 |
| [01-主要概念.md](./01-主要概念.md) | introduction.md | Token、速率限制等核心概念 |
| [02-模型列表.md](./02-模型列表.md) | models.md | 可用模型列表 |

## 二、API 参考

| 文件 | 对应文档 | 说明 |
|------|---------|------|
| [API-概述.md](./API-概述.md) | api/overview.md | API 认证、SDK 安装 |
| [API-快速开始.md](./API-快速开始.md) | api/quickstart.md | 快速上手代码示例 |
| [API-创建对话补全.md](./API-创建对话补全.md) | api/chat.md | Chat Completions 完整参考 |
| [API-工具调用.md](./API-工具调用.md) | api/tool-use.md | Tool Use / Function Calling |
| [API-模型参数参考.md](./API-模型参数参考.md) | api/models-overview.md | 各模型参数对比 |
| [API-文件与工具接口.md](./API-文件与工具接口.md) | api/files.md 等 | 文件/余额/模型列表/Token 计算 API |
| [API-错误说明.md](./API-错误说明.md) | api/errors.md | 错误码参考 |

## 三、功能指南（Guide）

### 3.1 功能特性文档（手工复制）

| 文件 | 对应文档 | 说明 |
|------|---------|------|
| [使用 Kimi API 的 JSON Mode.md](./使用%20Kimi%20API%20的%20JSON%20Mode.md) | guide/use-json-mode | JSON Mode 使用 |
| [使用 Kimi API 的 Partial Mode.md](./使用%20Kimi%20API%20的%20Partial%20Mode.md) | guide/use-partial-mode | Partial Mode 预填充 |
| [使用 Kimi API 的流式输出功能.md](./使用%20Kimi%20API%20的流式输出功能.md) | guide/utilize-streaming | SSE 流式输出 |
| [使用 Kimi API 进行文件问答.md](./使用%20Kimi%20API%20进行文件问答.md) | guide/file-qa | 文件问答 |
| [自动断线重连.md](./自动断线重连.md) | guide/auto-reconnect | 断线重连机制 |
| [BatchAPI.md](./BatchAPI.md) | api/batch-* | Batch API 完整参考 |

### 3.2 模型与工具指南

| 文件 | 对应文档 | 说明 |
|------|---------|------|
| [Guide-Kimi-K2.7-Code快速开始.md](./Guide-Kimi-K2.7-Code快速开始.md) | guide/kimi-k2-7-code-quickstart | K2.7 Code 模型介绍与示例 |
| [Guide-Kimi-K2.6-快速开始.md](./Guide-Kimi-K2.6-快速开始.md) | guide/kimi-k2-6-quickstart | K2.6 模型快速开始 |
| [Guide-使用思考模型.md](./Guide-使用思考模型.md) | guide/use-kimi-k2-thinking-model | 思考模型使用指南 |
| [Guide-视觉模型与联网搜索与迁移指南.md](./Guide-视觉模型与联网搜索与迁移指南.md) | guide/use-kimi-vision-model 等 | 视觉模型、联网搜索、迁移指南 |
| [Guide-工具调用完整指南.md](./Guide-工具调用完整指南.md) | guide/use-kimi-api-to-complete-tool-calls | 工具调用完整教程（1226行） |
| [Guide-官方工具详解.md](./Guide-官方工具详解.md) | guide/use-official-tools | 官方 Formula 工具详解 |
| [Guide-开始使用Kimi-API.md](./Guide-开始使用Kimi-API.md) | guide/start-using-kimi-api | API 入门示例 |
| [Guide-多轮对话.md](./Guide-多轮对话.md) | guide/multi-turn | 多轮对话实现 |
| [Guide-Prompt最佳实践.md](./Guide-Prompt最佳实践.md) | guide/prompt-best-practice | Prompt 编写最佳实践 |
| [Guide-常见问题FAQ.md](./Guide-常见问题FAQ.md) | guide/faq | 常见问题及解决方案 |
| [Guide-基准测试最佳实践.md](./Guide-基准测试最佳实践.md) | guide/benchmark-best-practice | Benchmark 参数推荐（749行） |

### 3.3 工具与平台

| 文件 | 对应文档 | 说明 |
|------|---------|------|
| [Guide-Kimi-CLI使用指南.md](./Guide-Kimi-CLI使用指南.md) | guide/kimi-cli-support | CLI 安装和使用 |
| [Guide-编程工具中使用Kimi-K2.7-Code.md](./Guide-编程工具中使用Kimi-K2.7-Code.md) | guide/agent-support | Claude Code/Roo Code/Cline 集成 |
| [Guide-使用Playground调试模型.md](./Guide-使用Playground调试模型.md) | guide/use-playground | Playground 调试指南 |
| [Guide-使用MoonPalace调试工具.md](./Guide-使用MoonPalace调试工具.md) | guide/use-moonpalace | MoonPalace API 调试工具 |
| [Guide-ModelScope-MCP服务器配置.md](./Guide-ModelScope-MCP服务器配置.md) | guide/configure-modelscope_mcp | ModelScope MCP 配置 |
| [Guide-使用OpenClaw连接Kimi模型.md](./Guide-使用OpenClaw连接Kimi模型.md) | guide/use-kimi-in-openclaw | OpenClaw 跨平台 AI 智能体 |
| [Guide-组织管理与官方工具.md](./Guide-组织管理与官方工具.md) | guide/org-best-practice | 组织认证、IP白名单、项目管理 |

### 3.4 批量处理与迁移

| 文件 | 对应文档 | 说明 |
|------|---------|------|
| [Guide-使用Batch-API批量处理任务.md](./Guide-使用Batch-API批量处理任务.md) | guide/use-batch-api | Batch API 完整指南（1070行） |
| [Guide-使用控制台进行批量推理.md](./Guide-使用控制台进行批量推理.md) | guide/use-batch-inference | 控制台批量推理 |
| [Guide-从OpenAI迁移到Kimi-API.md](./Guide-从OpenAI迁移到Kimi-API.md) | guide/migrating-from-openai | OpenAI 迁移指南 |

## 四、定价与计费（Pricing）

| 文件 | 对应文档 | 说明 |
|------|---------|------|
| [Pricing-定价与计费.md](./Pricing-定价与计费.md) | pricing/* (综合) | 定价总览、批量推理、K2.5、V1 定价 |
| [Pricing-模型推理价格说明.md](./Pricing-模型推理价格说明.md) | pricing/chat | 计费基本概念 |
| [Pricing-Kimi-K2.6定价.md](./Pricing-Kimi-K2.6定价.md) | pricing/chat-k26 | K2.6 模型定价 |
| [Pricing-Kimi-K2.7-Code定价.md](./Pricing-Kimi-K2.7-Code定价.md) | pricing/chat-k27-code | K2.7 Code 定价 |
| [Pricing-充值与限速.md](./Pricing-充值与限速.md) | pricing/limits | Tier 分级与速率限制 |
| [Pricing-联网搜索定价.md](./Pricing-联网搜索定价.md) | pricing/tools | 联网搜索 ¥0.03/次 |
| [Pricing-限时活动.md](./Pricing-限时活动.md) | pricing/promotion | 充值赠券活动 |

## 五、协议与政策（Agreement）

| 文件 | 对应文档 | 说明 |
|------|---------|------|
| [Agreement-服务协议.md](./Agreement-服务协议.md) | agreement/modeluse | Kimi 开放平台服务协议 |
| [Agreement-充值协议.md](./Agreement-充值协议.md) | agreement/payment | 充值协议 |
| [Agreement-隐私政策.md](./Agreement-隐私政策.md) | agreement/userprivacy | 隐私政策 |
| [Agreement-用户服务协议.md](./Agreement-用户服务协议.md) | agreement/userservice | 用户服务协议 |

---

> 本文档仅供项目内部参考资料使用，内容版权归 Moonshot AI 所有。
> 最新文档请访问：https://platform.kimi.com/docs
