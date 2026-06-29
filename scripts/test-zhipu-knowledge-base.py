#!/usr/bin/env python3
"""
智谱 AI 知识库调用测试脚本（增强调试版 V2）
知识库 ID: 2057857904412954624
"""

import sys
import json

try:
    from zai import ZhipuAiClient
except ImportError:
    print("❌ 未安装 zai-sdk，请先安装: pip install zai-sdk")
    sys.exit(1)

# 配置
API_KEY = "your-api-key"
KNOWLEDGE_ID = "2057857904412954624"
MODEL = "glm-4.6"

def test_knowledge_base(question=None, use_prompt_template=True):
    """测试知识库调用"""
    print("=" * 60)
    print("智谱 AI 知识库调用测试")
    print("=" * 60)
    print(f"知识库 ID: {KNOWLEDGE_ID}")
    print(f"模型: {MODEL}")
    print(f"prompt_template: {'开启' if use_prompt_template else '关闭'}")
    print("=" * 60)

    if API_KEY == "your-api-key":
        print("\n❌ 错误: 请先设置 API_KEY")
        return False

    try:
        print("\n📡 正在初始化智谱 AI 客户端...")
        client = ZhipuAiClient(api_key=API_KEY)
        print("✅ 客户端初始化成功")

        test_question = question or "你好，请介绍一下这个知识库的内容"
        print(f"\n💬 测试问题: {test_question}")
        print("📖 正在调用知识库...\n")

        # 构建 retrieval 工具配置
        retrieval_config = {
            "knowledge_id": KNOWLEDGE_ID,
        }
        if use_prompt_template:
            retrieval_config["prompt_template"] = (
                "从文档\n\"\"\"\nknowledge\n\"\"\"\n中找问题\n\"\"\"\nquestion\n\"\"\"\n的答案，"
                "找到答案就仅使用文档语句回答问题，找不到答案就用自身知识回答并且告诉用户该信息不是来自文档。\n"
                "不要复述问题，直接开始回答。"
            )

        # 非流式调用以获取完整响应
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "user", "content": test_question},
            ],
            tools=[
                {
                    "type": "retrieval",
                    "retrieval": retrieval_config,
                }
            ],
            stream=False,
        )

        # 打印 AI 回答
        msg = response.choices[0].message
        print("🤖 AI 回答:")
        print("-" * 60)
        full_response = msg.content or ""
        print(full_response)
        print("-" * 60)

        # 打印核心调试信息
        print(f"\n📊 核心调试信息:")
        print(f"  model: {response.model}")
        print(f"  finish_reason: {response.choices[0].finish_reason}")
        if hasattr(response, 'usage') and response.usage:
            u = response.usage
            print(f"  prompt_tokens: {u.prompt_tokens}")
            print(f"  completion_tokens: {u.completion_tokens}")
            print(f"  total_tokens: {u.total_tokens}")

        # 打印 reasoning_content（推理过程，包含检索到的文档内容线索）
        if hasattr(msg, 'reasoning_content') and msg.reasoning_content:
            print(f"\n🧠 reasoning_content (推理过程):")
            print("-" * 60)
            print(msg.reasoning_content)
            print("-" * 60)

        # 打印 tool_calls
        if hasattr(msg, 'tool_calls') and msg.tool_calls:
            print(f"\n📋 tool_calls:")
            for i, tc in enumerate(msg.tool_calls):
                print(f"  [{i}] id={tc.id}, type={tc.type}")
                if hasattr(tc, 'function') and tc.function:
                    print(f"      function name: {tc.function.name}")
                    print(f"      function args: {tc.function.arguments}")
                # 尝试打印所有属性
                for attr in dir(tc):
                    if not attr.startswith('_') and attr not in ('id', 'type', 'function'):
                        val = getattr(tc, attr, None)
                        if val is not None and not callable(val):
                            print(f"      {attr}: {val}")

        print("\n" + "=" * 60)
        print(f"✅ 调用成功！回答长度: {len(full_response)} 字符")
        return True

    except Exception as e:
        print(f"\n❌ 调用失败: {type(e).__name__}")
        print(f"错误信息: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    import os
    if os.getenv("ZHIPU_API_KEY"):
        API_KEY = os.getenv("ZHIPU_API_KEY")

    # 支持命令行参数: --no-template 关闭 prompt_template, 其余为问题内容
    args = sys.argv[1:]
    use_template = True
    question_parts = []
    for arg in args:
        if arg == "--no-template":
            use_template = False
        else:
            question_parts.append(arg)
    question = " ".join(question_parts) if question_parts else None

    success = test_knowledge_base(question, use_template)
    sys.exit(0 if success else 1)
