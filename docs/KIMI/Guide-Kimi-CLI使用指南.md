# 使用 Kimi CLI 调用 Kimi 大模型

> 来源：https://platform.kimi.com/docs/guide/kimi-cli-support

## Kimi Code CLI 是什么

Kimi Code CLI 是一个运行在终端中的 AI Agent，帮助完成软件开发任务和日常终端操作——阅读和修改代码、执行 Shell 命令、搜索文件、抓取网页，并在执行过程中根据反馈自主规划和调整。

适用场景：
- **编写和修改代码**：实现新功能、修复 bug、完成重构
- **理解项目**：探索陌生代码库，解答架构和实现问题
- **自动化任务**：批量处理文件、运行构建与测试

## 安装

### 脚本安装（推荐）

**macOS / Linux：**
```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
```

**Windows（PowerShell）：**
```powershell
irm https://code.kimi.com/kimi-code/install.ps1 | iex
```

### npm 安装

需要 Node.js 24.15.0 或更高版本：
```bash
npm install -g @moonshot-ai/kimi-code
```

## 第一次启动

```bash
cd your-project
kimi
```

非交互模式：
```bash
kimi -p "帮我看一下这个项目的目录结构"
```

继续上次会话：
```bash
kimi -C
```

首次启动需配置 API 来源，输入 `/login` 进入登录流程：
- **Kimi Code（OAuth）**：验证码流程
- **Kimi Platform API 密钥**：输入 API 密钥

## 常用命令

| 命令 | 说明 |
|------|------|
| `/new` | 开启新会话 |
| `/sessions` | 浏览历史会话 |
| `/model` | 切换模型 |
| `/compact` | 手动压缩上下文 |
| `/fork` | 派生当前会话 |
| `/help` | 命令和快捷键面板 |
| `/exit` | 退出 |

## 常用快捷键

| 快捷键 | 说明 |
|--------|------|
| `Esc` | 中断流式输出 / 关闭弹窗 |
| `Ctrl-C` | 中断输出；空闲时连按两次退出 |
| `Shift-Tab` | 切换 Plan 模式 |
| `Ctrl-S` | 输出中途插入消息 |
| `Ctrl-O` | 折叠 / 展开工具输出 |

## 数据存放

默认在 `~/.kimi-code/`，包含配置文件、会话记录、日志和更新缓存。可通过 `KIMI_CODE_HOME` 环境变量指定新路径。
