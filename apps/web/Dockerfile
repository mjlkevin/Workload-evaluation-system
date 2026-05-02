# ============================================================
# Web 前端多阶段 Dockerfile
# 构建上下文：仓库根目录（monorepo workspace）
# ============================================================

# ------------------------------
# 阶段 1：构建（build）
# ------------------------------
FROM node:24-alpine AS build

WORKDIR /repo

# 复制 lock 文件和 package.json
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# 安装全部依赖（npm workspaces 提升到根 node_modules）
RUN npm ci

# 复制源码
COPY apps/web ./apps/web

# 构建前端（Vite 产物输出到 apps/web/dist）
RUN npm run build -w apps/web

# ------------------------------
# 阶段 2：运行时（nginx）
# ------------------------------
FROM nginx:alpine AS runtime

# 复制自定义 nginx 配置
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# 复制构建产物
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
