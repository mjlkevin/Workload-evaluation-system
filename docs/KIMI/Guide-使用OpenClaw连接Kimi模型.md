# 使用 OpenClaw 连接 Kimi 模型

> 来源：https://platform.kimi.com/docs/guide/use-kimi-in-openclaw.md

OpenClaw 是一个开源的自托管 AI 智能体平台，集成了 WhatsApp、Telegram、Discord、Slack 和 Signal 等消息应用。

## 第一步：创建 Kimi 开放平台 API Key

- 新注册账户请先完成组织认证，认证后可获得 15 元免费代金券
- 建议充值 50 元以上升级到 tier1
- 创建并复制 API 密钥

## 第二步：安装 OpenClaw

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

**建议升级到 2026.2.3 及以上版本**，从 2.3 版本起全面支持国内开放平台的 Kimi K2.5 模型选择。

## 第三步：设置 Kimi K2.5

1. Model.auth provider > 选择 Moonshot AI (Kimi K2.5)
2. Model AI auth method > 选择 Kimi API key (.cn)
3. Enter Moonshot API Key > 输入 API Key
4. Default model > 保持当前（moonshot/kimi-K2.5）

安装完成后自动访问 http://127.0.0.1:18789 打开聊天界面。

## 一键安装包

中国地区用户推荐桌面端一键安装包：https://claw.ver0.cn/
