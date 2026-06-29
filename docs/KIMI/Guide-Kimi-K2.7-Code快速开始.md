# Kimi K2.7 Code

> 来源：https://platform.kimi.com/docs/guide/kimi-k2-7-code-quickstart.md

## 模型介绍

Kimi K2.7 Code 是 Kimi 迄今最智能的 Coding 模型，在长上下文中更可靠地遵循指令，能以更高的成功率完成编程任务，同时支持文本、图片与视频输入，思考模式，对话与 Agent 任务。

**Kimi K2.7 Code HighSpeed** 是高速版模型，输出速度约为普通版的 5-6 倍，常规编程场景下约 180 Token/s，短上下文场景可达 260 Token/s。

### 能力突破
- K2.7 Code 相比 K2.6：Kimi Code Bench v2 提升 21.8%、Program-Bench 提升 11%、MLS Bench Lite 提升 31.5%
- Agent 能力：Kimi Claw 24/7 Bench、MCP Atlas 和 MCP Mark Verified 基准测试中性能提升 10%

### 特性
- 256K 上下文窗口
- 支持长思考，擅长深度推理
- 仅支持思考模式（不支持非思考模式）

## 调用示例

### 安装 OpenAI SDK
```python
pip install --upgrade 'openai>=1.0'
```

### 多模态工具能力示例

K2.7 Code 综合了视觉理解+工具调用能力。支持通过 Agent Loop 进行视频分析等多模态任务。

## 最佳实践

### 支持的格式
- 图片：png、jpeg、webp、gif
- 视频：mp4、mpeg、mov、avi、x-flv、mpg、webm、wmv、3gpp

### Tokens 计算
图片与视频进行动态 token 计算，可通过[计算 token 接口](/api/estimate)获取消耗。

### 分辨率说明
- 图片推荐不超过 4k (4096*2160)
- 视频推荐不超过 1080p (1920*1080)

### 使用限制
- 图片数量无限制，但请求 Body 不超过 100M
- 不支持 URL 格式图片，仅支持 base64 编码

## 参数变动说明

| 字段 | 说明 | 默认值/限制 |
|------|------|-----------|
| max_tokens | 生成的最大 token 数 | 默认 32k (32768) |
| thinking | 控制是否启用思考 | 默认 `{"type": "enabled"}`，关闭会报错 |
| temperature | 采样温度 | 固定 1.0，其他值报错 |
| top_p | 采样方法 | 固定 0.95，其他值报错 |
| n | 生成结果数 | 固定 1，其他值报错 |
| presence_penalty | 存在惩罚 | 固定 0.0，其他值报错 |
| frequency_penalty | 频率惩罚 | 固定 0.0，其他值报错 |

## Tool Use 参数兼容性

- `tool_choice` 只能使用 "auto" 和 "none"
- 多步工具调用时必须保留 `reasoning_content` 在上下文中
