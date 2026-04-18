import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** @type {import('next').NextConfig} */
// 服务端反写 /api（SSR、无浏览器直连时）。浏览器在开发本机访问时默认直连 API，见 lib/api-client.ts。
// Docker / 远程部署示例：WORKLOAD_API_ORIGIN=http://host.docker.internal:3000
// 可选：NEXT_PUBLIC_WORKLOAD_API_ORIGIN、NEXT_PUBLIC_API_PORT（开发直连 API，见 lib/api-client.ts）
const apiOrigin = process.env.WORKLOAD_API_ORIGIN || "http://127.0.0.1:3000"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Next.js dev 会拦截未在白名单的 Origin 对 /_next/* 的请求；若用局域网 IP 打开页面而此处未包含该 IP，
 * 客户端 chunk 无法加载，Auth 等 client 逻辑永不执行，页面会长期停在「正在校验登录状态…」。
 * 启动时自动加入本机非回环的 RFC1918 IPv4；另可通过 NEXT_ALLOWED_DEV_ORIGINS 追加（逗号分隔）。
 */
function privateLanIPv4Hostnames() {
  const out = new Set()
  const ifaces = os.networkInterfaces()
  if (!ifaces) return []
  for (const infos of Object.values(ifaces)) {
    if (!infos) continue
    for (const info of infos) {
      if (info.internal) continue
      const isV4 = info.family === "IPv4" || info.family === 4
      if (!isV4) continue
      const addr = info.address
      const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr)
      if (!m) continue
      const oct = [1, 2, 3, 4].map((i) => Number(m[i]))
      if (oct.some((n) => n > 255)) continue
      const [a, b] = oct
      if (a === 10) out.add(addr)
      else if (a === 192 && b === 168) out.add(addr)
      else if (a === 172 && b >= 16 && b <= 31) out.add(addr)
    }
  }
  return [...out]
}

// 用局域网 IP 打开 dev（如 http://172.16.x.x:3001）时，允许 HMR 等 dev 资源跨域
const allowedDevOrigins = [
  ...new Set(
    [
      "localhost",
      "127.0.0.1",
      ...privateLanIPv4Hostnames(),
      ...(process.env.NEXT_ALLOWED_DEV_ORIGINS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ].filter(Boolean),
  ),
]

const nextConfig = {
  allowedDevOrigins,
  turbopack: {
    root: __dirname,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`,
      },
      {
        source: "/downloads/:path*",
        destination: `${apiOrigin}/downloads/:path*`,
      },
    ]
  },
}

export default nextConfig
