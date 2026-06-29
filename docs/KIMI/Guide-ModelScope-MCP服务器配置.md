# 在 Playground 中配置 ModelScope MCP 服务器

> 来源：https://platform.kimi.com/docs/guide/configure-the-modelscope-mcp-server.md

Kimi 开放平台与 ModelScope 魔搭达成官方合作，简化了 Playground 添加 MCP 服务器的操作步骤。

## 配置步骤

### 第一步：点击配置按钮
登录 Kimi Playground (https://platform.kimi.com/playground)，进入「MCP 服务器设置」。

### 第二步：同步外部平台
1. 选中 ModelScope 作为 MCP 服务提供商
2. 获取 ModelScope API 令牌：访问 https://modelscope.cn/my/myaccesstoken
3. 粘贴 API 令牌到输入框
4. 点击「开始同步」按钮

同步完成后，所有已配置的魔搭 Hosted MCP 服务将出现在可用列表中。

### 增量更新
在 ModelScope MCP 广场新增或删除托管 MCP 服务后，可在"设置-MCP 服务器-同步服务器"中点击同步按钮进行增量更新。

## 结合模型与 MCP 的使用

同步 MCP 服务后，可在左侧"MCP 服务列表"中多选并启用要使用的 MCP 服务。支持高德地图等工具集成。
