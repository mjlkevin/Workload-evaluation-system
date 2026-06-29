> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 问答 Agent 对话（流式）

> 基于 ReAct（Reasoning + Acting）推理引擎的流式对话接口。LLM 会根据用户问题自主决定是否调用工具（知识检索、查询重写等），并通过 SSE 实时推送思考过程、工具调用和最终回答。



## OpenAPI

````yaml /openapi/openapi.json post /zrag/agent/chat
openapi: 3.0.1
info:
  title: ZHIPU AI API
  description: ZHIPU AI 接口提供强大的 AI 能力，包括聊天对话、工具调用和视频生成。
  license:
    name: ZHIPU AI 开发者协议和政策
    url: https://chat.z.ai/legal-agreement/terms-of-service
  version: 1.0.0
  contact:
    name: Z.AI 开发者
    url: https://chat.z.ai/legal-agreement/privacy-policy
    email: user_feedback@z.ai
servers:
  - url: https://open.bigmodel.cn/api/
    description: 开放平台服务
security:
  - bearerAuth: []
tags:
  - name: 模型 API
    description: Chat API
  - name: 工具 API
    description: Web Search API
  - name: Agent API
    description: Agent API
  - name: 文件 API
    description: File API
  - name: 知识库 API
    description: Knowledge API
  - name: 实时 API
    description: Realtime API
  - name: 批处理 API
    description: Batch API
  - name: 助理 API
    description: Assistant API
  - name: 智能体 API（旧）
    description: QingLiu Agent API
paths:
  /zrag/agent/chat:
    post:
      tags:
        - Agent API
      summary: 问答 Agent 对话（流式）
      description: >-
        基于 ReAct（Reasoning + Acting）推理引擎的流式对话接口。LLM
        会根据用户问题自主决定是否调用工具（知识检索、查询重写等），并通过 SSE 实时推送思考过程、工具调用和最终回答。
      parameters:
        - name: X-Session-Id
          in: header
          description: 会话 ID，续聊时传入
          required: false
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/AgentChatRequest'
            example:
              messages:
                - role: user
                  content: 公司的年假制度是什么？
              model: glm-5v-turbo
              temperature: 0.2
              max_steps: 10
              retrieval:
                know_ids:
                  - '123'
                top_k: 8
                top_n: 10
                enable_rerank: false
      responses:
        '200':
          description: SSE 流式响应，返回 AgentStreamEvent 事件流
          content:
            text/event-stream:
              schema:
                $ref: '#/components/schemas/AgentStreamEvent'
        default:
          description: 请求失败
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/LlmApplicationError'
components:
  schemas:
    AgentChatRequest:
      type: object
      required:
        - messages
        - retrieval
      properties:
        messages:
          type: array
          description: 当前消息列表，支持多模态内容
          items:
            $ref: '#/components/schemas/AgentMessage'
        model:
          type: string
          default: glm-5v-turbo
          description: LLM 模型名称，默认为 glm-5v-turbo
        temperature:
          type: number
          default: 0.7
          description: 采样温度，默认为 0.7
        max_steps:
          type: integer
          default: 10
          description: 最大推理步数，默认为 10
        retrieval:
          $ref: '#/components/schemas/AgentRetrieval'
        enable_thinking:
          type: boolean
          default: false
          description: 是否启用思考模式。启用后模型输出推理过程，通过 reasoning 事件流式返回
    AgentStreamEvent:
      type: object
      description: SSE 事件流中的单个事件对象
      properties:
        type:
          type: string
          enum:
            - session_created
            - reasoning
            - thought
            - tool_call
            - tool_result
            - answer
            - done
            - error
          description: 事件类型
        sessionId:
          type: string
          description: 会话 ID
        messageId:
          type: string
          description: 消息 ID（仅 done 事件）
        data:
          description: 事件负载，结构取决于 type
          oneOf:
            - type: string
            - $ref: '#/components/schemas/AgentToolCallData'
            - $ref: '#/components/schemas/AgentToolResultData'
            - $ref: '#/components/schemas/AgentErrorData'
        usage:
          $ref: '#/components/schemas/AgentUsage'
    LlmApplicationError:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
    AgentMessage:
      type: object
      required:
        - role
        - content
      properties:
        role:
          type: string
          enum:
            - user
          description: 角色：user
        content:
          description: 消息内容。纯文本用 String，多模态用 ContentPart 数组
          oneOf:
            - type: string
            - type: array
              items:
                $ref: '#/components/schemas/AgentContentPart'
    AgentRetrieval:
      type: object
      description: 检索预设参数。预设后 LLM 仅决定是否调用检索，无需自行填写参数
      properties:
        know_ids:
          type: array
          description: 知识库 ID 列表
          items:
            type: string
        top_k:
          type: integer
          description: 检索数量
          default: 8
        top_n:
          type: integer
          description: 召回数量
          default: 10
        enable_rerank:
          type: boolean
          description: 是否启用重排序
          default: false
        similarity_threshold:
          type: number
          description: 相似度阈值
          default: 0.2
      required:
        - know_ids
    AgentToolCallData:
      type: object
      description: type=tool_call 时的 data 结构
      properties:
        callId:
          type: string
          description: 工具调用 ID
        toolName:
          description: 工具名称
          type: string
        arguments:
          type: object
          description: 工具调用参数
          additionalProperties: true
    AgentToolResultData:
      type: object
      description: type=tool_result 时的 data 结构
      properties:
        callId:
          type: string
          description: 工具调用 ID
        toolName:
          description: 工具名称
          type: string
        result:
          description: 执行结果
          additionalProperties: true
        status:
          type: string
          enum:
            - success
            - error
          description: 执行状态
        durationMs:
          type: integer
          format: int64
          description: 执行耗时（毫秒）
    AgentErrorData:
      type: object
      description: type=error 时的 data 结构
      properties:
        message:
          type: string
          description: 错误描述
    AgentUsage:
      type: object
      description: Token 用量信息（仅 done 事件）
      properties:
        prompt_tokens:
          type: integer
          description: 输入 Token 数
        completion_tokens:
          type: integer
          description: 输出 Token 数
        total_tokens:
          type: integer
          description: 总 Token 数
        total_calls:
          type: integer
          description: 工具调用总次数
        prompt_tokens_details:
          type: object
          properties:
            cached_tokens:
              type: integer
              description: 缓存命中 Token 数
        completion_tokens_details:
          type: object
          properties:
            reasoning_tokens:
              type: integer
              description: 推理 Token 数
    AgentContentPart:
      type: object
      properties:
        type:
          type: string
          enum:
            - text
            - image_url
          description: 内容类型
        text:
          type: string
          description: 文本内容（type=text 时）
        image_url:
          type: object
          description: 图片 URL（type=image_url 时）
          properties:
            url:
              type: string
              description: 图片链接地址
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        使用以下格式进行身份验证：Bearer [<your api
        key>](https://bigmodel.cn/usercenter/proj-mgmt/apikeys)

````