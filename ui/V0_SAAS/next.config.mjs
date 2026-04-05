/** @type {import('next').NextConfig} */
// 后端地址：默认本机 API；Docker / 远程部署时设环境变量，例如 WORKLOAD_API_ORIGIN=http://host.docker.internal:3000
const apiOrigin = process.env.WORKLOAD_API_ORIGIN || "http://127.0.0.1:3000"

const nextConfig = {
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
