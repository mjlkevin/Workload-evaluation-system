import path from "node:path"
import { fileURLToPath } from "node:url"

/** @type {import('next').NextConfig} */
// 服务端反写 /api（SSR、无浏览器直连时）。浏览器在开发本机访问时默认直连 API，见 lib/api-client.ts。
// Docker / 远程部署示例：WORKLOAD_API_ORIGIN=http://host.docker.internal:3000
// 可选：NEXT_PUBLIC_WORKLOAD_API_ORIGIN、NEXT_PUBLIC_API_PORT（开发直连 API，见 lib/api-client.ts）
const apiOrigin = process.env.WORKLOAD_API_ORIGIN || "http://127.0.0.1:3000"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 用局域网 IP 打开 dev（如 http://172.16.x.x:3001）时，允许 HMR 等 dev 资源跨域
const allowedDevOrigins = [
  ...new Set(
    [
      "localhost",
      "127.0.0.1",
      "172.16.2.98",
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
