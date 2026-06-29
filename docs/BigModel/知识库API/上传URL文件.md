> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 上传URL文档

> 上传`URL`类型的文档或网页作为内容填充知识库。



## OpenAPI

````yaml /openapi/openapi.json post /llm-application/open/document/upload_url
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
  /llm-application/open/document/upload_url:
    post:
      tags:
        - 知识库 API
      summary: 上传URL文档
      description: 上传`URL`类型的文档或网页作为内容填充知识库。
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UploadUrlKnowledgeRequest'
        required: true
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UploadUrlKnowledgeResponse'
              example:
                data:
                  successInfos:
                    - documentId: '122121212'
                      url: xxx.com
                    - documentId: '12121212121'
                      url: xxx.com
                  failedInfos:
                    - url: xxx.com
                      failReason: 不支持的文档类型
                code: 200
                message: 请求成功
                timestamp: 1689649504996
        default:
          description: 请求失败
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/LlmApplicationError'
components:
  schemas:
    UploadUrlKnowledgeRequest:
      type: object
      properties:
        upload_detail:
          type: array
          items:
            $ref: '#/components/schemas/UrlData'
          description: url列表
        knowledge_id:
          type: string
          description: 知识库id
      required:
        - upload_detail
        - knowledge_id
    UploadUrlKnowledgeResponse:
      type: object
      properties:
        data:
          type: object
          properties:
            successInfos:
              type: array
              items:
                type: object
                properties:
                  documentId:
                    type: string
                    description: 文档id
                  url:
                    type: string
                    description: url
            failedInfos:
              type: array
              items:
                type: object
                properties:
                  url:
                    type: string
                    description: url
                  failReason:
                    type: string
                    description: 失败原因
        code:
          type: integer
          description: 状态码
        message:
          type: string
          description: 返回信息
        timestamp:
          type: integer
          description: 时间戳
    LlmApplicationError:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
    UrlData:
      type: object
      properties:
        url:
          type: string
          description: url
        knowledge_type:
          type: integer
          description: 文档切片类型
        custom_separator:
          type: array
          items:
            type: string
          description: |
            自定义切片分隔符，仅 knowledge_type=5 时生效，默认 
        sentence_size:
          type: integer
          description: 自定义切片字数，仅 knowledge_type=5 时生效，20-2000，默认300
        callback_url:
          type: string
          description: 回调地址
        callback_header:
          type: object
          description: 回调header k-v
      required:
        - url
        - knowledge_type
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        使用以下格式进行身份验证：Bearer [<your api
        key>](https://bigmodel.cn/usercenter/proj-mgmt/apikeys)

````