# ============================================================
# API 服务多阶段 Dockerfile
# 构建上下文：仓库根目录（monorepo workspace）
# ============================================================

# ------------------------------
# 阶段 1：依赖安装（deps）
# ------------------------------
FROM node:24-alpine AS deps

WORKDIR /repo

# 先复制 lock 文件和 package.json，利用 Docker layer cache
# 注：根 package.json 的 workspaces 仅含 apps/api（apps/web 已删除，git 跟踪 0 文件，不可 COPY）
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/

# 安装全部依赖（含 devDependencies，供 build 阶段使用）
# npm workspaces 会将所有依赖提升到根 node_modules
RUN npm ci

# ------------------------------
# 阶段 2：编译（build）
# ------------------------------
FROM node:24-alpine AS build

WORKDIR /repo

# 从 deps 阶段复制已安装好的 node_modules（workspace 根目录唯一一份；
# apps/api/node_modules 是 lock 决定的非 hoist 包如 ajv@8，必须一并复制，
# 否则 tsc 向上解析到根 node_modules 的同名包版本（如 ajv@6）导致编译失败）
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules

# 复制源码与配置
COPY package.json package-lock.json ./
COPY apps/api ./apps/api
COPY config ./config
COPY apps/api/drizzle ./apps/api/drizzle

# 编译 API
RUN npm run build -w apps/api

# ------------------------------
# 阶段 3：运行时（runtime）
# ------------------------------
FROM node:24-alpine AS runtime

# 安装 curl（健康检查用）
RUN apk add --no-cache curl

WORKDIR /repo

# 复制 lock 文件和 workspace package.json，按 workspace 收窄只装生产依赖
# 不安装 tsx / drizzle-kit（devDependency；启动迁移走已编译的 dist/db/migrate.js + drizzle-orm 生产依赖）
# 不安装 supertest（纯测试断言库，无部署用途）
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w apps/api --omit=dev

# 复制构建产物与运行时所需文件
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY config ./config
COPY apps/api/drizzle ./apps/api/drizzle

WORKDIR /repo/apps/api

ENV NODE_ENV=production
EXPOSE 3000

# Docker 健康检查
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
