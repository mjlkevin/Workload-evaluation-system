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
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# 安装全部依赖（含 devDependencies，供 build 阶段使用）
# npm workspaces 会将所有依赖提升到根 node_modules
RUN npm ci

# ------------------------------
# 阶段 2：编译（build）
# ------------------------------
FROM node:24-alpine AS build

WORKDIR /repo

# 从 deps 阶段复制已安装好的 node_modules（workspace 根目录唯一一份）
COPY --from=deps /repo/node_modules ./node_modules

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

# 复制 lock 文件和 workspace package.json，只装生产依赖
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev && npm install -g tsx drizzle-kit && npm install supertest @types/supertest

# 复制构建产物与运行时所需文件
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/src ./apps/api/src
COPY config ./config
COPY apps/api/drizzle ./apps/api/drizzle

WORKDIR /repo/apps/api

ENV NODE_ENV=production
EXPOSE 3000

# Docker 健康检查
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
