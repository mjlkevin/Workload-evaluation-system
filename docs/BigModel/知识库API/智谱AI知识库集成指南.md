# 智谱 AI 知识库集成指南

> 基于实测验证的技术文档，供 WES Agent 系统后续接入智谱 GLM 知识库检索能力使用。

## 1. 概述

智谱 AI 提供基于 GLM 模型的知识库检索（retrieval）能力，支持将用户上传的文档作为知识源，通过 `retrieval` 工具在对话中自动检索相关文档片段并注入 prompt，实现 RAG（检索增强生成）问答。

### 1.1 核心信息

| 项目 | 值 |
|------|-----|
| SDK | `zai-sdk` (Python) |
| SDK 版本 | `0.2.3`（实测最低要求版本，`0.2.2` 存在兼容问题） |
| 模型 | `glm-4.6` |
| 知识库 ID | `2057857904412954624` |
| API 认证 | API Key（从 [智谱开放平台](https://open.bigmodel.cn/) 获取） |
| 环境变量 | `ZHIPU_API_KEY` |

### 1.2 适用场景

- 基于企业内部文档的智能问答
- 产品知识库检索（金蝶产品模块、功能说明等）
- 标准化文档的自动化咨询回复

---

## 2. 环境配置

### 2.1 安装 SDK

```bash
# 安装最新版本
pip install zai-sdk

# 或指定版本（推荐）
pip install zai-sdk==0.2.3
```

验证安装：

```python
import zai
print(zai.__version__)
```

### 2.2 环境变量

```bash
# 在 .env 或 shell 中配置
export ZHIPU_API_KEY="your-api-key"
```

> ⚠️ **安全提示**：API Key 禁止提交到 Git，仅通过环境变量或密钥管理服务注入。

---

## 3. API 调用

### 3.1 基础调用模板（推荐）

```python
from zai import ZhipuAiClient
import os

client = ZhipuAiClient(api_key=os.getenv("ZHIPU_API_KEY"))

response = client.chat.completions.create(
    model="glm-4.6",
    messages=[
        {"role": "user", "content": "你的问题"},
    ],
    tools=[
        {
            "type": "retrieval",
            "retrieval": {
                "knowledge_id": "2057857904412954624",
                # ⚠️ 不要使用 prompt_template，会导致 retrieval 不触发
            }
        }
    ],
    stream=False,  # 非流式，获取完整响应
)

# 获取回答
answer = response.choices[0].message.content
print(answer)

# 获取推理过程（含检索到的文档内容线索）
if hasattr(response.choices[0].message, 'reasoning_content'):
    reasoning = response.choices[0].message.reasoning_content
```

### 3.2 流式调用模板

```python
response = client.chat.completions.create(
    model="glm-4.6",
    messages=[
        {"role": "user", "content": "你的问题"},
    ],
    tools=[
        {
            "type": "retrieval",
            "retrieval": {
                "knowledge_id": "2057857904412954624",
            }
        }
    ],
    stream=True,
)

for chunk in response:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end='', flush=True)
```

### 3.3 TypeScript/Node.js 调用（适用于 WES 后端集成）

智谱 API 兼容 OpenAI API 格式，可直接使用 `openai` SDK：

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.ZHIPU_API_KEY,
  baseURL: "https://open.bigmodel.cn/api/paas/v4",
});

const response = await client.chat.completions.create({
  model: "glm-4.6",
  messages: [{ role: "user", content: "你的问题" }],
  tools: [
    {
      type: "retrieval",
      retrieval: {
        knowledge_id: "2057857904412954624",
      },
    },
  ],
  stream: false,
});

const answer = response.choices[0].message.content;
```

---

## 4. 响应结构

### 4.1 核心字段

```python
response = client.chat.completions.create(...)

# 模型回答
content = response.choices[0].message.content        # str | None

# 推理过程（含检索到的文档内容分析）
reasoning = response.choices[0].message.reasoning_content  # str | None

# 模型信息
model = response.model                                # "glm-4.6"

# 完成原因
finish_reason = response.choices[0].finish_reason    # "stop" | "tool_calls" | ...

# Token 用量
usage = response.usage
# usage.prompt_tokens       — 输入 token 数（含检索注入的文档内容）
# usage.completion_tokens   — 输出 token 数
# usage.total_tokens        — 总 token 数
```

### 4.2 判断 retrieval 是否触发

通过 `prompt_tokens` 判断知识库检索是否生效：

| prompt_tokens | retrieval 状态 | 说明 |
|:---:|:---:|---|
| < 100 | ❌ 未触发 | 检索未执行，仅用户问题被送入模型 |
| > 1000 | ✅ 已触发 | 文档内容被检索并注入到 prompt 中 |

---

## 5. 关键发现与注意事项

### 5.1 ⚠️ prompt_template 导致检索失效（已验证）

**问题描述**：官方文档提供的 `prompt_template` 使用 `knowledge` 和 `question` 作为占位符，但实测发现**带 `prompt_template` 时 retrieval 工具不会触发**。

**实测对比数据**：

| 配置 | prompt_tokens | retrieval | 回答行为 |
|------|:---:|:---:|---|
| 带 `prompt_template` | 57 | ❌ 未触发 | 模型将 `knowledge`/`question` 当做字面文本，要求用户提供实际内容 |
| 不带 `prompt_template` | 2262~3152 | ✅ 触发 | 正常检索文档内容并回答 |

**结论**：当前版本（zai-sdk 0.2.3 + glm-4.6）**禁用 `prompt_template`**，仅使用 `knowledge_id` 即可。默认检索行为已能满足需求。

**错误写法（禁用）**：
```python
# ❌ 不要这样写 — retrieval 不会触发
tools=[{
    "type": "retrieval",
    "retrieval": {
        "knowledge_id": "2057857904412954624",
        "prompt_template": "从文档\n\"\"\"\nknowledge\n\"\"\"\n中找问题..."  # 导致检索失效
    }
}]
```

**正确写法（推荐）**：
```python
# ✅ 仅使用 knowledge_id，retrieval 正常触发
tools=[{
    "type": "retrieval",
    "retrieval": {
        "knowledge_id": "2057857904412954624",
    }
}]
```

### 5.2 检索命中率与问法相关

知识库文档以**具体模块名称**（如"智能会计平台"、"资金计划"、"融资管理"）组织内容。当问题使用文档中不存在的总称（如"金蝶AI套件"）时，即使检索到了文档内容，模型也会判断为"信息不来自文档"。

**实测对比**：

| 问题 | retrieval | 检索结果 | 回答来源 |
|------|:---:|---|---|
| "金蝶AI套件有哪些模块" | ✅ | 检索到文档但内容不匹配 | 模型自身知识 |
| "智能会计平台是什么" | ✅ | 检索到完整匹配内容 | ✅ 文档内容 |

**建议**：提问时尽量使用文档中的具体术语和模块名称。

### 5.3 reasoning_content 字段

`glm-4.6` 模型返回 `reasoning_content` 字段，包含模型的完整推理过程。该字段会展示模型如何分析检索到的文档内容、如何判断是否匹配、如何组织回答。对调试检索效果非常有价值。

### 5.4 知识库文档内容（实测）

当前知识库 `2057857904412954624` 包含金蝶产品相关文档，已知涵盖：

- 智能会计平台（设计理念、核心价值、主要功能）
- 资金计划
- 融资管理
- 销售管理
- 网上银行

---

## 6. 完整集成示例（Python）

```python
#!/usr/bin/env python3
"""
智谱 AI 知识库检索 — 生产级调用封装
"""

import os
from zai import ZhipuAiClient


class ZhipuKnowledgeBase:
    """智谱知识库检索封装"""

    def __init__(self, api_key=None, knowledge_id="2057857904412954624", model="glm-4.6"):
        self.client = ZhipuAiClient(api_key=api_key or os.getenv("ZHIPU_API_KEY"))
        self.knowledge_id = knowledge_id
        self.model = model

    def query(self, question: str, stream: bool = False) -> dict:
        """
        查询知识库

        Args:
            question: 用户问题
            stream: 是否流式返回

        Returns:
            dict: {
                "content": str,          # AI 回答
                "reasoning": str | None,  # 推理过程
                "model": str,            # 模型名称
                "prompt_tokens": int,    # 输入 token 数
                "completion_tokens": int,# 输出 token 数
                "total_tokens": int,     # 总 token 数
                "retrieval_triggered": bool,  # 检索是否触发
            }
        """
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "user", "content": question},
            ],
            tools=[
                {
                    "type": "retrieval",
                    "retrieval": {
                        "knowledge_id": self.knowledge_id,
                    },
                }
            ],
            stream=stream,
        )

        if stream:
            return self._handle_stream(response)

        msg = response.choices[0].message
        usage = response.usage

        return {
            "content": msg.content,
            "reasoning": getattr(msg, "reasoning_content", None),
            "model": response.model,
            "prompt_tokens": usage.prompt_tokens if usage else 0,
            "completion_tokens": usage.completion_tokens if usage else 0,
            "total_tokens": usage.total_tokens if usage else 0,
            "retrieval_triggered": (usage.prompt_tokens > 100) if usage else False,
        }

    def _handle_stream(self, response):
        """处理流式响应"""
        full_content = ""
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                full_content += chunk.choices[0].delta.content
                yield chunk.choices[0].delta.content

    def query_stream(self, question: str):
        """流式查询，逐字返回"""
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "user", "content": question},
            ],
            tools=[
                {
                    "type": "retrieval",
                    "retrieval": {
                        "knowledge_id": self.knowledge_id,
                    },
                }
            ],
            stream=True,
        )
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content


# 使用示例
if __name__ == "__main__":
    kb = ZhipuKnowledgeBase()

    # 非流式查询
    result = kb.query("智能会计平台是什么")
    print(f"回答: {result['content']}")
    print(f"检索触发: {result['retrieval_triggered']}")
    print(f"Token 用量: {result['total_tokens']}")

    # 流式查询
    print("\n流式输出:")
    for text in kb.query_stream("智能会计平台有哪些功能"):
        print(text, end="", flush=True)
```

---

## 7. 测试脚本

项目内置测试脚本：[scripts/test-zhipu-knowledge-base.py](file:///Users/kevin/AI/Workload-evaluation-system-agent/scripts/test-zhipu-knowledge-base.py)

### 7.1 使用方式

```bash
# 设置 API Key
export ZHIPU_API_KEY="your-api-key"

# 基础测试（默认问题）
python3 scripts/test-zhipu-knowledge-base.py

# 指定问题测试（不带 prompt_template，推荐）
python3 scripts/test-zhipu-knowledge-base.py --no-template "智能会计平台是什么"

# 指定问题测试（带 prompt_template，仅用于对比调试）
python3 scripts/test-zhipu-knowledge-base.py "智能会计平台是什么"
```

### 7.2 脚本功能

- ✅ 支持 `--no-template` 参数切换是否使用 `prompt_template`
- ✅ 支持命令行传入自定义问题
- ✅ 打印 `reasoning_content` 推理过程（含检索文档分析）
- ✅ 打印 `prompt_tokens` 等核心调试信息
- ✅ 打印 `tool_calls`（如有）
- ✅ 完整的错误处理和堆栈追踪

---

## 8. 接入 WES 系统建议

### 8.1 配置项

在 `apps/api/.env.example` 中新增：

```env
# 智谱 AI（知识库检索）
ZHIPU_API_KEY=
ZHIPU_MODEL=glm-4.6
ZHIPU_KNOWLEDGE_ID=2057857904412954624
ZHIPU_API_BASE_URL=https://open.bigmodel.cn/api/paas/v4
```

### 8.2 集成路径

智谱 API 兼容 OpenAI API 格式，WES 后端（Node.js/TypeScript）可直接复用现有 `openai` SDK，仅需修改 `baseURL` 和认证方式：

```typescript
// services/zhipu/zhipu.client.ts
import OpenAI from "openai";

export const zhipuClient = new OpenAI({
  apiKey: process.env.ZHIPU_API_KEY!,
  baseURL: process.env.ZHIPU_API_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
});
```

### 8.3 与 Kimi 的关系

WES 当前 AI 评估使用 Kimi（Moonshot）作为主力模型。智谱知识库检索可作为**补充能力**接入，适用于需要基于结构化产品文档回答的场景。两者不冲突，可按场景路由：

| 场景 | 推荐模型 |
|------|---------|
| SOW 评估、工作量估算 | Kimi（已集成） |
| 金蝶产品知识问答 | 智谱 GLM + 知识库检索 |
| 合同风险分析 | 智谱 GLM + 知识库检索 |

---

## 9. 版本记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-06-23 | v1.0 | 初始版本，基于实测结果编写 |
