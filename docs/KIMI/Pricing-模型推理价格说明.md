# 模型推理价格说明

> 来源：https://platform.kimi.com/docs/pricing/chat.md

## 计费基本概念

### 计费单元
Token：代表常见的字符序列。对于一段通常的中文文本，1 个 Token 大约相当于 1.5-2 个汉字。实际产生的 Tokens 数量可通过调用[计算 Token API](/api/estimate) 获得。

### 计费逻辑
- Chat Completion 接口对 Input 和 Output 均实行按量计费
- 上传并抽取文档内容作为 Input 时，文档内容也按量计费
- 文件相关接口（文件内容抽取/文件存储）限时免费

## 模型定价

各模型详细定价请查看：
- **Kimi K2.7 Code**：编程模型，详见 [K2.7 Code 定价](/pricing/chat-k27-code)
- **Kimi K2.6**：多模态模型，详见 [K2.6 定价](/pricing/chat-k26)
- **Kimi K2.5**：多模态模型，详见 [K2.5 定价](/pricing/chat-k25)
- **Moonshot V1**：经典生成模型系列，详见 [V1 定价](/pricing/chat-v1)
