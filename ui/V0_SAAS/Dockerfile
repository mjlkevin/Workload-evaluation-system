# 主前端 Next.js。构建上下文：ui/V0_SAAS
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG WORKLOAD_API_ORIGIN=http://api:3000
ENV WORKLOAD_API_ORIGIN=$WORKLOAD_API_ORIGIN
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ARG WORKLOAD_API_ORIGIN=http://api:3000
ENV WORKLOAD_API_ORIGIN=$WORKLOAD_API_ORIGIN
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3001
CMD ["npm", "run", "start"]
