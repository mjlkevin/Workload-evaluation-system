# 环境变量说明

后端服务读取顺序：**先** 仓库根目录或 `apps/api` 下的 `.env.local`，**再** `.env`（见 `apps/api/src/main.ts` 中 `dotenv` 配置）。

## 通用

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `PORT` | 否 | `3000` | API 监听端口 |
| `JWT_SECRET` | 生产必填 | 开发内置弱密钥 | JWT 签名密钥，**生产环境必须更换** |
| `JWT_EXPIRES_IN` | 否 | `8h` | Token 有效期 |

## 需求导入 / Excel 智能解析（Kimi / Moonshot）

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `KIMI_API_KEY` | 使用 AI 解析时必填 | 无 | Moonshot API Key，仅服务端使用，勿提交到仓库 |
| `KIMI_MODEL` | 否 | `moonshot-v1-8k` | 模型名 |
| `KIMI_API_BASE_URL` | 否 | `https://api.moonshot.cn/v1` | API 基址 |

## 前端

前端通过 `Vite` 开发时默认请求本地 API；跨域与代理若需配置，在 `apps/web/vite.config` 中维护（以实际文件为准）。

## 本地示例文件

可将下列内容保存为 **`.env.local`**（路径建议与 `apps/api` 运行时 `cwd` 一致，一般为仓库根或 `apps/api`）：

```bash
PORT=3000
JWT_SECRET=please-change-in-production
JWT_EXPIRES_IN=8h
KIMI_API_KEY=
KIMI_MODEL=moonshot-v1-8k
```

**注意**：不要将包含真实 Key 的 `.env.local` 提交到 Git。
