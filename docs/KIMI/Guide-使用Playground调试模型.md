# 使用 Playground 调试模型

> 来源：https://platform.kimi.com/docs/guide/use-playground-to-debug-the-model.md

[Playground 开发工作台](https://platform.kimi.com/playground) 是一个强大的模型调试和测试平台。

## 功能特性

1. 调整观察模型在不同参数下的表现和输出效果
2. 通过使用内置工具，体验模型的 tool calling 能力
3. 对比不同模型在相同参数下的效果
4. 监控 tokens 使用情况来优化成本

## 模型调试功能

### 提示信息设置
- 设置系统提示词（System Prompt）
- 支持 system/user/assistant 三种角色

### 模型配置
- **模型选择**：Moonshot V1 系列/Kimi K2 系列/Kimi K2.6 等
- **参数配置**：详见请求参数说明

### 模型对话
- 聊天内容发送
- Tool 调用显示（调用 ID/工具参数/返回结果）
- 查看代码：API 调用代码并提供复制功能
- 底部统计：输入/输出/总计 tokens 消耗

## 工具调试

### 官方工具
- 日期时间工具、Excel 文件分析工具、联网搜索工具、随机数生成工具等
- 限时免费，负载达上限时可能限流
- 支持通过 Kimi API 调用

### MCP 服务器
- 可配置 ModelScope MCP 服务器
- 也可配置其他 MCP 服务器

### Show Case
- **今日新闻报告**：运用日期工具、web_search、rethink 等
- **表格分析工具**：excel 分析工具

## 模型对比
- 支持最多 3 个模型同时调用对比

## 分享对话
- **导出**：导出当前对话为 .json 格式文件
- **导入**：导入分享的 .json 对话内容
